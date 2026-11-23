"""Authorized upload, listing and download of private incident evidence."""

from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth.dependencies import get_db
from app.auth.policy import IncidentPolicy, Principal, get_principal
from app.core.config import get_settings
from app.evidence.models import IncidentAttachment
from app.evidence.storage import (
    MAX_BYTES,
    detect_content_type,
    safe_filename,
    stored_path,
    write_private_file,
)
from app.incidents.models import Incident
from app.incidents.router import IncidentRoute, _request_id, error_response
from app.workflow.contracts import WorkflowViolation
from app.workflow.models import AuditLog

router = APIRouter(prefix="/api/v1/incidents", tags=["evidence"], route_class=IncidentRoute)


def _incident(db: Session, principal: Principal, incident_id: UUID) -> Incident:
    incident = db.get(Incident, incident_id, populate_existing=True)
    if incident is None:
        raise WorkflowViolation("not_found", 404)
    decision = IncidentPolicy().evaluate(principal, incident, "evidence")
    if not decision.allowed:
        raise WorkflowViolation(decision.code, decision.http_status)
    return incident


@router.post("/{incident_id}/attachments", status_code=201)
async def upload_attachment(
    incident_id: UUID,
    request: Request,
    response: Response,
    principal: Annotated[Principal, Depends(get_principal)],
    db: Annotated[Session, Depends(get_db)],
    file: Annotated[UploadFile, File()],
    expected_version: Annotated[int, Form(ge=1)],
):
    request_id = _request_id(request)
    content = await file.read(MAX_BYTES + 1)
    await file.close()
    if not content or len(content) > MAX_BYTES:
        return error_response(422, "validation_error", "File size must be 1 to 10 MiB", request_id)
    content_type = detect_content_type(content)
    if content_type is None or file.content_type != content_type:
        return error_response(422, "validation_error", "Invalid file content type", request_id)
    if not file.filename:
        return error_response(422, "validation_error", "Filename is required", request_id)

    path: Path | None = None
    try:
        with db.begin_nested():
            incident = _incident(db, principal, incident_id)
            is_owner = str(incident.reporter_id) == principal.user_id
            is_staff = IncidentPolicy().can_operate(principal, incident)
            if not (is_owner or is_staff):
                raise WorkflowViolation("forbidden", 403)
            if incident.status == "closed":
                raise WorkflowViolation("invalid_transition", 409)
            if incident.version != expected_version:
                raise WorkflowViolation("version_conflict", 409)
            count = db.scalar(
                select(func.count())
                .select_from(IncidentAttachment)
                .where(IncidentAttachment.incident_id == incident_id)
            )
            if count >= 5:
                raise WorkflowViolation("attachment_limit", 409)
            changed = db.execute(
                update(Incident)
                .where(
                    Incident.id == incident_id,
                    Incident.version == expected_version,
                    Incident.status == incident.status,
                )
                .values(version=Incident.version + 1)
                .execution_options(synchronize_session=False)
            )
            if changed.rowcount != 1:
                raise WorkflowViolation("version_conflict", 409)
            attachment = IncidentAttachment(
                id=uuid4(),
                incident_id=incident_id,
                uploaded_by=UUID(principal.user_id),
                storage_key=uuid4().hex,
                original_name=safe_filename(file.filename),
                content_type=content_type,
                size_bytes=len(content),
                created_at=datetime.now(UTC),
            )
            path = write_private_file(get_settings().evidence_dir, attachment.storage_key, content)
            db.add(attachment)
            db.add(
                AuditLog(
                    incident_id=incident_id,
                    actor_id=UUID(principal.user_id),
                    action="incident.attachment_uploaded",
                    request_id=request_id,
                    before={"version": expected_version},
                    after={"version": expected_version + 1},
                )
            )
            db.flush()
        db.commit()
    except Exception:
        db.rollback()
        if path is not None:
            path.unlink(missing_ok=True)
        raise
    response.headers["X-Request-ID"] = str(request_id)
    return {
        "id": attachment.id,
        "original_name": attachment.original_name,
        "content_type": attachment.content_type,
        "size_bytes": attachment.size_bytes,
        "created_at": attachment.created_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "incident_version": expected_version + 1,
    }


@router.get("/{incident_id}/attachments")
def list_attachments(
    incident_id: UUID,
    request: Request,
    response: Response,
    principal: Annotated[Principal, Depends(get_principal)],
    db: Annotated[Session, Depends(get_db)],
):
    _incident(db, principal, incident_id)
    records = db.scalars(
        select(IncidentAttachment)
        .where(IncidentAttachment.incident_id == incident_id)
        .order_by(IncidentAttachment.created_at, IncidentAttachment.id)
    )
    response.headers["X-Request-ID"] = str(_request_id(request))
    return {
        "items": [
            {
                "id": item.id,
                "original_name": item.original_name,
                "content_type": item.content_type,
                "size_bytes": item.size_bytes,
                "created_at": item.created_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
            }
            for item in records
        ]
    }


@router.get("/{incident_id}/attachments/{attachment_id}/download")
def download_attachment(
    incident_id: UUID,
    attachment_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(get_principal)],
    db: Annotated[Session, Depends(get_db)],
):
    _incident(db, principal, incident_id)
    attachment = db.scalar(
        select(IncidentAttachment).where(
            IncidentAttachment.id == attachment_id,
            IncidentAttachment.incident_id == incident_id,
        )
    )
    if attachment is None:
        raise WorkflowViolation("not_found", 404)
    try:
        path = stored_path(get_settings().evidence_dir, attachment.storage_key)
    except ValueError:
        raise WorkflowViolation("not_found", 404) from None
    if not path.is_file():
        raise WorkflowViolation("not_found", 404)
    return FileResponse(
        path,
        media_type=attachment.content_type,
        filename=safe_filename(attachment.original_name),
        content_disposition_type="attachment",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Request-ID": str(_request_id(request)),
        },
    )

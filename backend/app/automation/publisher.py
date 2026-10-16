import uuid
from datetime import UTC, datetime
from typing import Protocol, runtime_checkable

from app.automation.schemas import EventEnvelope, EventType


class IdempotencyConflictError(Exception):
    """Raised when an event with the same ID but conflicting payload is published."""

    pass


@runtime_checkable
class EventPublisher(Protocol):
    """Event publisher port interface for CIM backend modules (N2, N3, N4, N5).

    Other modules (such as N2 incident creation or N3 SLA check) call this stable port
    to emit domain events without depending on outbox tables or live n8n workers.
    """

    def publish(self, event: EventEnvelope) -> None:
        """Publish an event envelope into the messaging sink/outbox."""
        ...

    def create_and_publish(
        self,
        event_type: EventType,
        incident_id: uuid.UUID,
        request_id: uuid.UUID,
        occurred_at: datetime | None = None,
        event_id: uuid.UUID | None = None,
    ) -> EventEnvelope:
        """Helper to create and publish an envelope in a single step."""
        ...


class InMemoryEventPublisher:
    """In-memory event sink implementation.

    Used for:
    - Independent unit & integration testing by N2, N3, N4, N5
    - Decoupled development when outbox worker / n8n is offline
    - Idempotency verification
    """

    def __init__(self) -> None:
        self._events: list[EventEnvelope] = []
        self._events_by_id: dict[uuid.UUID, EventEnvelope] = {}

    def publish(self, event: EventEnvelope) -> None:
        if event.event_id in self._events_by_id:
            existing = self._events_by_id[event.event_id]
            # Verify payload identicality for idempotency
            if existing == event:
                return  # Idempotently accepted
            raise IdempotencyConflictError(
                f"Event with ID '{event.event_id}' already exists with different payload."
            )

        self._events.append(event)
        self._events_by_id[event.event_id] = event

    def create_and_publish(
        self,
        event_type: EventType,
        incident_id: uuid.UUID,
        request_id: uuid.UUID,
        occurred_at: datetime | None = None,
        event_id: uuid.UUID | None = None,
    ) -> EventEnvelope:
        envelope = EventEnvelope(
            event_id=event_id or uuid.uuid4(),
            event_type=event_type,
            incident_id=incident_id,
            request_id=request_id,
            occurred_at=occurred_at or datetime.now(UTC),
        )
        self.publish(envelope)
        return envelope

    def get_events(self) -> list[EventEnvelope]:
        return list(self._events)

    def get_event_by_id(self, event_id: uuid.UUID) -> EventEnvelope | None:
        return self._events_by_id.get(event_id)

    def filter_by_type(self, event_type: EventType) -> list[EventEnvelope]:
        return [e for e in self._events if e.event_type == event_type]

    def clear(self) -> None:
        self._events.clear()
        self._events_by_id.clear()

    def __len__(self) -> int:
        return len(self._events)


_active_publisher: EventPublisher = InMemoryEventPublisher()


def get_event_publisher() -> EventPublisher:
    """Return the global event publisher port instance."""
    return _active_publisher


def set_event_publisher(publisher: EventPublisher) -> None:
    """Override the global event publisher (useful in fixtures and test setup)."""
    global _active_publisher
    _active_publisher = publisher

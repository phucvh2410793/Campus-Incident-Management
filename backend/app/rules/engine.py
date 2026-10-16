from app.rules.schemas import RuleResult

RULE_VERSION = "demo-v1"
MANUAL_QUEUE = "Hàng đợi phân loại thủ công"


def evaluate_incident(
    report_type: str,
    answers: dict[str, str],
) -> RuleResult:
    """Evaluate an incident using the ordered demo-v1 rules."""

    # R01: Electrical hazard with smoke or sparks.
    if report_type == "electrical_hazard" and answers.get("smoke_or_sparks") == "yes":
        return RuleResult(
            rule_id="R01",
            severity="Critical",
            priority="P1",
            department="Điện và an toàn",
            reason="Dấu hiệu nguy hiểm tức thời",
        )

    # R02: Phishing with information entered.
    if report_type == "phishing" and answers.get("interaction") == "entered_information":
        return RuleResult(
            rule_id="R02",
            severity="High",
            priority="P1",
            department="IT/Security",
            reason="Nguy cơ lộ thông tin",
        )

    # R03: Water leak near electricity.
    if report_type == "water_leak" and answers.get("near_electricity") == "yes":
        return RuleResult(
            rule_id="R03",
            severity="High",
            priority="P1",
            department="Cơ sở vật chất",
            reason="Nước gần điện cần ưu tiên cao; gắn cờ an toàn",
            safety_flags=("near_electricity",),
        )

    # R04: Electrical hazard with an exposed wire.
    if report_type == "electrical_hazard" and answers.get("exposed_wire") == "yes":
        return RuleResult(
            rule_id="R04",
            severity="High",
            priority="P1",
            department="Điện và an toàn",
            reason="Nguy cơ chạm điện",
        )

    # R05: Phishing link clicked, but no information entered.
    if report_type == "phishing" and answers.get("interaction") == "clicked_link":
        return RuleResult(
            rule_id="R05",
            severity="Medium",
            priority="P2",
            department="IT/Security",
            reason="Cần kiểm tra thiết bị/tài khoản",
        )

    # R06: Large water leak not near electricity.
    if (
        report_type == "water_leak"
        and answers.get("leak_size") == "large"
        and answers.get("near_electricity") == "no"
    ):
        return RuleResult(
            rule_id="R06",
            severity="Medium",
            priority="P2",
            department="Cơ sở vật chất",
            reason="Có nguy cơ lan rộng/trơn trượt",
        )

    # R07: Small water leak not near electricity.
    if (
        report_type == "water_leak"
        and answers.get("leak_size") == "small"
        and answers.get("near_electricity") == "no"
    ):
        return RuleResult(
            rule_id="R07",
            severity="Low",
            priority="P3",
            department="Cơ sở vật chất",
            reason="Chưa có dấu hiệu tăng cấp",
        )

    # R08: Phishing received without interaction.
    if report_type == "phishing" and answers.get("interaction") == "none":
        return RuleResult(
            rule_id="R08",
            severity="Low",
            priority="P3",
            department="IT/Security",
            reason="Chưa ghi nhận tương tác",
        )

    # R09: Electrical hazard without an exposed wire, smoke, or sparks.
    if (
        report_type == "electrical_hazard"
        and answers.get("exposed_wire") == "no"
        and answers.get("smoke_or_sparks") == "no"
    ):
        return RuleResult(
            rule_id="R09",
            severity="Medium",
            priority="P2",
            department="Điện và an toàn",
            reason="Cần kiểm tra tại chỗ",
        )

    # No rule matched: do not silently assign a low priority.
    return RuleResult(
        rule_id=None,
        severity=None,
        priority=None,
        department=MANUAL_QUEUE,
        reason="Thiếu dữ liệu hoặc không khớp quy tắc; cần phân loại thủ công",
        triage_required=True,
    )

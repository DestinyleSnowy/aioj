from fastapi import APIRouter, Depends

from app.dependencies import require_admin
from app.services.system_settings import get_setting_bool, set_setting_bool

router = APIRouter()


@router.get("/health")
def health():
    return {"ok": True, "version": "scorer-v1"}


@router.get("/api/config")
def public_config():
    return {"registration_enabled": get_setting_bool("registration_enabled", True)}


@router.get("/api/admin/settings")
def admin_settings(user=Depends(require_admin)):
    return {"registration_enabled": get_setting_bool("registration_enabled", True)}


@router.post("/api/admin/settings/registration")
def admin_set_registration(payload: dict, user=Depends(require_admin)):
    enabled = bool(payload.get("enabled"))
    set_setting_bool("registration_enabled", enabled)
    return {"ok": True, "registration_enabled": enabled}

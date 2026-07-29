from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends

from app.auth.dependencies import AdminUserDep
from app.db import get_pool
from app.schemas.system import StatsResponse, SystemStatus
from app.services import system_service

router = APIRouter(prefix="/api/system", tags=["system"])

PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]


@router.get("/status", response_model=SystemStatus)
async def system_status(pool: PoolDep, _admin: AdminUserDep) -> SystemStatus:
    return await system_service.get_status(pool)


@router.get("/stats", response_model=StatsResponse)
async def system_stats(pool: PoolDep, _admin: AdminUserDep) -> StatsResponse:
    return await system_service.get_stats(pool)

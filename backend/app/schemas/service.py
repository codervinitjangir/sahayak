from typing import Optional
from pydantic import BaseModel, ConfigDict


class ServiceCategoryBase(BaseModel):
    code: str
    name: str


class ServiceCategoryCreate(ServiceCategoryBase):
    pass


class ServiceCategoryResponse(ServiceCategoryBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class ServiceBase(BaseModel):
    code: str
    name: str
    requires_vehicle_equipment: Optional[bool] = False
    category_id: Optional[int] = None


class ServiceCreate(ServiceBase):
    pass


class ServiceResponse(ServiceBase):
    id: int

    model_config = ConfigDict(from_attributes=True)

from fastapi import APIRouter, File, UploadFile

from ..services import grayscale_service
from ..utils.upload_helper import process_pdf_upload

router = APIRouter()


@router.post("/grayscale")
async def grayscale_pdf(file: UploadFile = File(...)):
    return await process_pdf_upload(
        file,
        grayscale_service.convert_to_grayscale,
        output_filename="grayscale.pdf",
    )

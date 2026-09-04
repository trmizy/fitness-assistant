"""Pydantic models for InBody extraction results."""
from __future__ import annotations

from typing import Optional, Dict, Any
from pydantic import BaseModel, Field


class SegmentalAnalysis(BaseModel):
    """Five-segment body analysis (arms, trunk, legs)."""
    right_arm_muscle: Optional[float] = None
    left_arm_muscle: Optional[float] = None
    trunk_muscle: Optional[float] = None
    right_leg_muscle: Optional[float] = None
    left_leg_muscle: Optional[float] = None


class SegmentalConfidence(BaseModel):
    """Confidence scores for segmental values (0.0 – 1.0)."""
    right_arm_muscle: Optional[float] = None
    left_arm_muscle: Optional[float] = None
    trunk_muscle: Optional[float] = None
    right_leg_muscle: Optional[float] = None
    left_leg_muscle: Optional[float] = None


class ConfidenceScores(BaseModel):
    """Confidence for each extracted field."""
    weight: Optional[float] = None
    height: Optional[float] = None
    skeletal_muscle_mass: Optional[float] = None
    body_fat_mass: Optional[float] = None
    segmental_lean_analysis: SegmentalConfidence = Field(default_factory=SegmentalConfidence)
    segmental_fat_analysis: SegmentalConfidence = Field(default_factory=SegmentalConfidence)


class RawOCR(BaseModel):
    """Raw OCR text per block for debugging."""
    header: str = ""
    body_composition: str = ""
    muscle_fat_analysis: str = ""
    segmental_lean_analysis: str = ""
    segmental_fat_analysis: str = ""


class DebugInfo(BaseModel):
    """Paths and metadata for debugging."""
    warped_image_path: Optional[str] = None
    annotated_image_path: Optional[str] = None
    detected_blocks: Dict[str, Any] = Field(default_factory=dict)


class InBodyResult(BaseModel):
    """Complete extraction result from an InBody sheet."""
    weight: Optional[float] = None
    height: Optional[float] = None
    skeletal_muscle_mass: Optional[float] = None
    body_fat_mass: Optional[float] = None

    segmental_lean_analysis: SegmentalAnalysis = Field(default_factory=SegmentalAnalysis)
    segmental_fat_analysis: SegmentalAnalysis = Field(default_factory=SegmentalAnalysis)

    confidence: ConfidenceScores = Field(default_factory=ConfidenceScores)
    raw_ocr: RawOCR = Field(default_factory=RawOCR)
    debug: DebugInfo = Field(default_factory=DebugInfo)

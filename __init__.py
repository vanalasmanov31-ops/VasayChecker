"""vasay-quality 

Usage::

    from vasay_quality import transform

    # Convert a single file
    stats = transform("input.mp4", "output.mp4", multiplier=10)

    # Python API with all options
    stats = transform(
        input_path="video.mp4",
        output_path="output.mp4",
        multiplier=10,
        comment="MyTag123",
    )
"""

__version__ = "1.0.0"

from .transform import transform

__all__ = ["transform"]

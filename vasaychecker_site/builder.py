from __future__ import annotations

import struct
from typing import List, Tuple


def build_box(box_type: str, content: bytes) -> bytes:
    """Build a standard MP4 box: [size:4][type:4][content]."""
    return struct.pack('>I', 8 + len(content)) + box_type.encode('latin-1') + content


def build_ftyp(brand: str = 'isom', minor_version: int = 512,
               compatible: str = 'isomiso2avc1mp41') -> bytes:
    """Build an ftyp box with given brand."""
    content = brand.encode('latin-1') + struct.pack('>I', minor_version) + compatible.encode('latin-1')
    return build_box('ftyp', content)


def build_free() -> bytes:
    """Build a minimal 8-byte free box."""
    return struct.pack('>I', 8) + b'free'


def build_mvhd(original_content: bytes, duration_ms: int) -> bytes:
    """Build mvhd box with updated duration (offset 16 in content)."""
    content = bytearray(original_content)
    struct.pack_into('>I', content, 16, duration_ms)
    return build_box('mvhd', bytes(content))


def build_mdhd(original_content: bytes, duration: int | None = None, language: int | None = None) -> bytes:
    """Build mdhd box, optionally patching duration and language."""
    content = bytearray(original_content)
    if duration is not None:
        struct.pack_into('>I', content, 16, duration)
    if language is not None:
        struct.pack_into('>H', content, 20, language)
    return build_box('mdhd', bytes(content))


def build_tkhd(original_data: bytes, duration_ms: int | None = None) -> bytes:
    """Patch tkhd duration (offset 28). Takes full box bytes."""
    result = bytearray(original_data)
    if duration_ms is not None:
        struct.pack_into('>I', result, 28, duration_ms)
    return bytes(result)


def build_hdlr(handler_type: bytes, name: str) -> bytes:
    """Build an hdlr box with handler type and name."""
    content = (struct.pack('>II', 0, 0) + handler_type + b'\x00' * 12 +
               name.encode('utf-8') + b'\x00')
    return build_box('hdlr', content)


def build_stts(entries: List[Tuple[int, int]]) -> bytes:
    """Build stts box from [(sample_count, sample_delta), ...]."""
    body = b''.join(struct.pack('>II', c, d) for c, d in entries)
    return build_box('stts', struct.pack('>II', 0, len(entries)) + body)


def build_stsc(entries: List[Tuple[int, int, int]]) -> bytes:
    """Build stsc box from [(first_chunk, samples_per_chunk, desc_idx), ...]."""
    body = b''.join(struct.pack('>III', *e) for e in entries)
    return build_box('stsc', struct.pack('>II', 0, len(entries)) + body)


def build_stsz(sample_sizes: List[int]) -> bytes:
    """Build stsz box with variable per-sample sizes."""
    body = b''.join(struct.pack('>I', s) for s in sample_sizes)
    return build_box('stsz', struct.pack('>III', 0, 0, len(sample_sizes)) + body)


def build_stco(offsets: List[int]) -> bytes:
    """Build stco box from list of chunk offsets."""
    body = b''.join(struct.pack('>I', o) for o in offsets)
    return build_box('stco', struct.pack('>II', 0, len(offsets)) + body)


def build_stsd_video(fixed_fields: bytes, avcc: bytes, colr: bytes, pasp: bytes, btrt: bytes) -> bytes:
    """Build video stsd box from sub-components."""
    avc1_content = fixed_fields + avcc + colr + pasp + btrt
    avc1 = struct.pack('>I', 8 + len(avc1_content)) + b'avc1' + avc1_content
    return build_box('stsd', struct.pack('>II', 0, 1) + avc1)


def build_avcc(original_content: bytes, add_high_ext: bool = True) -> bytes:
    """Build avcC box, optionally adding High profile extension."""
    content = original_content
    if add_high_ext:
        content += b'\xfd\xf8\xf8\x00'
    return build_box('avcC', content)


def build_btrt(buffer_size_db: int, max_bitrate: int, avg_bitrate: int) -> bytes:
    """Build btrt (bitrate) box."""
    return build_box('btrt', struct.pack('>III', buffer_size_db, max_bitrate, avg_bitrate))


def build_udta_comment(comment: str) -> bytes:
    """Build udta box with iTunes-style comment metadata."""
    meta_hdlr = build_box('hdlr', struct.pack('>II', 0, 0) + b'mdir' + b'appl' + b'\x00' * 8 + b'\x00')
    data_box = build_box('data', struct.pack('>II', 1, 0) + comment.encode('utf-8'))
    cmt = struct.pack('>I', 8 + len(data_box)) + b'\xa9cmt' + data_box
    ilst = build_box('ilst', cmt)
    meta = build_box('meta', struct.pack('>I', 0) + meta_hdlr + ilst)
    return build_box('udta', meta)

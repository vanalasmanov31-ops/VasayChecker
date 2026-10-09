from __future__ import annotations

import struct
from typing import List, Optional, Tuple


def read_u32(data: bytes, offset: int) -> int:
    return struct.unpack('>I', data[offset:offset + 4])[0]


def read_u16(data: bytes, offset: int) -> int:
    return struct.unpack('>H', data[offset:offset + 2])[0]


def find_box(data: bytes, box_type: str, offset: int = 0, end: int | None = None) -> Tuple[Optional[int], Optional[int]]:
    """Find a box by type at current level. Returns (position, size) or (None, None)."""
    if end is None:
        end = len(data)
    pos = offset
    while pos + 8 <= end:
        size = read_u32(data, pos)
        btype = data[pos + 4:pos + 8].decode('latin-1')
        if size < 8:
            break
        if btype == box_type:
            return pos, size
        pos += size
    return None, None


def find_box_path(data: bytes, path: List[str], offset: int = 0, end: int | None = None) -> Tuple[Optional[int], Optional[int]]:
    """
    Navigate nested container boxes to find a target.
    Example: find_box_path(data, ['mdia', 'minf', 'stbl'])
    """
    if end is None:
        end = len(data)
    current_offset = offset
    current_end = end

    for i, box_type in enumerate(path):
        pos = current_offset
        while pos + 8 <= current_end:
            size = read_u32(data, pos)
            btype = data[pos + 4:pos + 8].decode('latin-1')
            if size < 8:
                break
            if btype == box_type:
                if i == len(path) - 1:
                    return pos, size
                current_offset = pos + 8
                current_end = pos + size
                break
            pos += size
        else:
            return None, None
    return None, None


def find_track_by_handler(data: bytes, moov_offset: int, moov_size: int, handler: bytes) -> Tuple[Optional[int], Optional[int]]:
    """Find a track by handler type (b'vide', b'soun')."""
    pos = moov_offset + 8
    end = moov_offset + moov_size
    while pos + 8 <= end:
        size = read_u32(data, pos)
        btype = data[pos + 4:pos + 8].decode('latin-1')
        if size < 8:
            break
        if btype == 'trak':
            hdlr_pos, _ = find_box_path(data, ['mdia', 'hdlr'], pos + 8, pos + size)
            if hdlr_pos:
                if data[hdlr_pos + 16:hdlr_pos + 20] == handler:
                    return pos, size
        pos += size
    return None, None


def parse_stts(data: bytes, offset: int) -> List[Tuple[int, int]]:
    """Parse time-to-sample box. Returns [(sample_count, sample_delta), ...]."""
    entry_count = read_u32(data, offset + 12)
    return [
        (read_u32(data, offset + 16 + i * 8), read_u32(data, offset + 20 + i * 8))
        for i in range(entry_count)
    ]


def parse_stsz(data: bytes, offset: int) -> List[int]:
    """Parse sample size box. Returns list of per-sample sizes."""
    uniform = read_u32(data, offset + 12)
    count = read_u32(data, offset + 16)
    if uniform != 0:
        return [uniform] * count
    return [read_u32(data, offset + 20 + i * 4) for i in range(count)]


def parse_stsc(data: bytes, offset: int) -> List[Tuple[int, int, int]]:
    """Parse sample-to-chunk box. Returns [(first_chunk, samples_per_chunk, desc_idx), ...]."""
    entry_count = read_u32(data, offset + 12)
    return [
        (read_u32(data, offset + 16 + i * 12),
         read_u32(data, offset + 20 + i * 12),
         read_u32(data, offset + 24 + i * 12))
        for i in range(entry_count)
    ]


def parse_stco(data: bytes, offset: int) -> List[int]:
    """Parse chunk offset box. Returns list of chunk offsets."""
    entry_count = read_u32(data, offset + 12)
    return [read_u32(data, offset + 16 + i * 4) for i in range(entry_count)]


def parse_nalu_list(sample_data: bytes) -> List[Tuple[int, int, bytes]]:
    """
    Parse NALUs in an AVC sample (4-byte length-prefixed).
    Returns [(nalu_type, nalu_length, full_nalu_with_prefix), ...].
    """
    nalus = []
    pos = 0
    while pos + 4 <= len(sample_data):
        nalu_len = read_u32(sample_data, pos)
        if pos + 4 + nalu_len > len(sample_data):
            break
        nalu_type = sample_data[pos + 4] & 0x1F
        nalus.append((nalu_type, nalu_len, sample_data[pos:pos + 4 + nalu_len]))
        pos += 4 + nalu_len
    return nalus

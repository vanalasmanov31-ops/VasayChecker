"""CLI interface for vasay-quality.

Usage:
    vasay-quality input.mp4 output.mp4 [options]
    python -m vasay_quality input.mp4 output.mp4 [options]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from . import __version__
from .transform import transform


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        prog='vasay-quality',
        description='vasay quality -- MP4 container manipulation (zero re-encoding)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  vasay-quality video.mp4 output.mp4
  vasay-quality video.mp4 output.mp4 -m 10
  vasay-quality video.mp4 output.mp4 --comment "MyTag"
  vasay-quality --verify output.mp4
  vasay-quality --check-deps
        """
    )
    parser.add_argument('input', nargs='?', help='Input MP4 file (H.264/AVC)')
    parser.add_argument('output', nargs='?', help='Output MP4 file path')
    parser.add_argument('-m', '--multiplier', type=int, default=10,
                        help='Frame count multiplier (default: 10)')
    parser.add_argument('-c', '--comment', type=str, default='vasay',
                        help='Metadata comment/signature tag')
    parser.add_argument('--verify', metavar='FILE',
                        help='Verify a file with ffprobe (no transformation)')
    parser.add_argument('--compare', nargs=2, metavar=('FILE', 'REFERENCE'),
                        help='Byte-compare two files')
    parser.add_argument('--check-deps', action='store_true',
                        help='Check and install dependencies')
    parser.add_argument('-q', '--quiet', action='store_true',
                        help='Suppress progress messages')
    parser.add_argument('-V', '--version', action='version', version=f'%(prog)s {__version__}')

    args = parser.parse_args()

    if args.check_deps:
        _check_deps()
        return

    if args.verify:
        if not Path(args.verify).exists():
            print(f"[!] File not found: {args.verify}", file=sys.stderr)
            sys.exit(1)
        _verify_ffprobe(args.verify)
        return

    if args.compare:
        f1, f2 = args.compare
        for f in (f1, f2):
            if not Path(f).exists():
                print(f"[!] File not found: {f}", file=sys.stderr)
                sys.exit(1)
        ok = _compare_files(f1, f2)
        sys.exit(0 if ok else 1)

    if not args.input or not args.output:
        parser.print_help()
        sys.exit(1)

    if not Path(args.input).exists():
        print(f"[!] File not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    transform(
        input_path=args.input,
        output_path=args.output,
        multiplier=args.multiplier,
        comment=args.comment,
        verbose=not args.quiet,
    )

    if not args.quiet:
        _verify_ffprobe(args.output)


def _verify_ffprobe(path: str):
    """Run ffprobe and print summary."""
    ffprobe = shutil.which('ffprobe')
    if not ffprobe:
        return
    try:
        r = subprocess.run(
            [ffprobe, '-v', 'quiet', '-show_format', '-show_streams', '-print_format', 'json', path],
            capture_output=True, text=True, timeout=30,
        )
        if r.returncode != 0:
            return
        info = json.loads(r.stdout)
        for s in info.get('streams', []):
            if s.get('codec_type') == 'video':
                print(f"[+] Video: {s.get('codec_name')} {s.get('width')}x{s.get('height')}, {s.get('nb_frames')} frames")
            elif s.get('codec_type') == 'audio':
                print(f"[+] Audio: {s.get('codec_name')} @ {s.get('sample_rate')} Hz")
        fmt = info.get('format', {})
        tags = fmt.get('tags', {})
        print(f"[+] Brand: {tags.get('major_brand', '?')}, Comment: {tags.get('comment', '-')}")
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError):
        pass


def _compare_files(path1: str, path2: str) -> bool:
    """Byte-for-byte comparison."""
    with open(path1, 'rb') as f:
        a = f.read()
    with open(path2, 'rb') as f:
        b = f.read()
    if a == b:
        print("[+] PERFECT MATCH - byte-for-byte identical")
        return True
    print(f"[-] Files differ: {len(a):,} vs {len(b):,} bytes")
    for i in range(min(len(a), len(b))):
        if a[i] != b[i]:
            print(f"    First diff @ byte {i}")
            break
    return False


def _check_deps():
    """Check all dependencies."""
    v = sys.version_info
    print(f"[+] Python {v.major}.{v.minor}.{v.micro}")

    ffprobe = shutil.which('ffprobe')
    ffmpeg = shutil.which('ffmpeg')
    print(f"[+] ffprobe: {ffprobe or 'NOT FOUND (optional)'}")
    print(f"[+] ffmpeg:  {ffmpeg or 'NOT FOUND (optional)'}")

    if not ffprobe:
        print("\n    Install FFmpeg:")
        print("      Windows: winget install Gyan.FFmpeg")
        print("      macOS:   brew install ffmpeg")
        print("      Linux:   sudo apt install ffmpeg")

    try:
        import vasay_quality
        print(f"[+] vasay-quality v{vasay_quality.__version__}")
    except ImportError:
        print("[!] Package not installed - run: pip install -e .")


if __name__ == '__main__':
    main()

/* NoBlur — https://github.com/irgifebry/NoBlur */
(function(global){
"use strict";
function parseBoxes(bytes, view, startOffset, endOffset) {
    const boxes = [];
    let offset = startOffset;
    while (offset + 8 <= endOffset) {
        const rawSize = view.getUint32(offset, false);
        let size;
        let is64Bit = false;

        if (rawSize === 0) {
            size = endOffset - offset;
        } else if (rawSize === 1) {
            is64Bit = true;
            if (offset + 16 > endOffset) break;
            const hi = view.getUint32(offset + 8, false);
            const lo = view.getUint32(offset + 12, false);
            const sizeBig = (BigInt(hi) << 32n) + BigInt(lo);
            if (sizeBig > BigInt(Number.MAX_SAFE_INTEGER)) break;
            size = Number(sizeBig);
        } else {
            size = rawSize;
        }

        if (size < 8 || offset + size > endOffset) break;

        const type = String.fromCharCode(
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        );
        boxes.push({ offset, size, type, end: offset + size, is64Bit });
        offset += size;
    }
    return boxes;
}

function getBoxHeaderSize(box) {
    return box.is64Bit ? 16 : 8;
}

const HANDLER_VIDEO = [0x76, 0x69, 0x64, 0x65];

function bytesEqualAt(bytes, offset, pattern) {
    for (let i = 0; i < pattern.length; i++) {
        if (bytes[offset + i] !== pattern[i]) return false;
    }
    return true;
}

function findHandlerType(bytes, hdlrBox) {
    const start = hdlrBox.offset + getBoxHeaderSize(hdlrBox);
    const end = hdlrBox.end;
    for (let i = start; i + 4 <= end; i++) {
        if (bytesEqualAt(bytes, i, HANDLER_VIDEO)) return "vide";
    }
    return null;
}

function detectCodecFromStbl(bytes, stblBox) {
    const children = parseBoxes(
        bytes,
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        stblBox.offset + getBoxHeaderSize(stblBox),
        stblBox.end,
    );
    const stsdBox = children.find((b) => b.type === "stsd");
    if (!stsdBox) return "unknown";
    const contentStart = stsdBox.offset + getBoxHeaderSize(stsdBox);
    if (contentStart + 16 > stsdBox.end) return "unknown";
    return String.fromCharCode(
        bytes[contentStart + 12],
        bytes[contentStart + 13],
        bytes[contentStart + 14],
        bytes[contentStart + 15],
    );
}

function detectVideoCodecFromMoov(bytes, view, moovBox) {
    const moovChildren = parseBoxes(
        bytes,
        view,
        moovBox.offset + getBoxHeaderSize(moovBox),
        moovBox.end,
    );

    for (const trak of moovChildren.filter((b) => b.type === "trak")) {
        const trakChildren = parseBoxes(
            bytes,
            view,
            trak.offset + getBoxHeaderSize(trak),
            trak.end,
        );
        const mdiaBox = trakChildren.find((b) => b.type === "mdia");
        if (!mdiaBox) continue;

        const mdiaChildren = parseBoxes(
            bytes,
            view,
            mdiaBox.offset + getBoxHeaderSize(mdiaBox),
            mdiaBox.end,
        );
        const minfBox = mdiaChildren.find((b) => b.type === "minf");
        if (!minfBox) continue;

        const minfChildren = parseBoxes(
            bytes,
            view,
            minfBox.offset + getBoxHeaderSize(minfBox),
            minfBox.end,
        );
        const stblBox = minfChildren.find((b) => b.type === "stbl");
        if (!stblBox) continue;

        return detectCodecFromStbl(bytes, stblBox);
    }

    return "unknown";
}

function updateBoxSize(view, offset, box, addedBytes) {
    if (box.is64Bit) {
        view.setBigUint64(offset + 8, BigInt(box.size + addedBytes), false);
    } else {
        view.setUint32(offset, box.size + addedBytes, false);
    }
}

function updateChunkOffsets(newBytes, newView, boxStart, boxEnd, delta) {
    const containerTypes = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
    for (const box of parseBoxes(newBytes, newView, boxStart, boxEnd)) {
        if (box.type === "stco") {
            const headerSize = getBoxHeaderSize(box);
            const count = newView.getUint32(box.offset + headerSize + 4, false);
            for (let i = 0; i < count; i++) {
                const pos = box.offset + headerSize + 8 + i * 4;
                newView.setUint32(
                    pos,
                    newView.getUint32(pos, false) + delta,
                    false,
                );
            }
        } else if (box.type === "co64") {
            const headerSize = getBoxHeaderSize(box);
            const count = newView.getUint32(box.offset + headerSize + 4, false);
            for (let i = 0; i < count; i++) {
                const pos = box.offset + headerSize + 8 + i * 8;
                newView.setBigUint64(
                    pos,
                    newView.getBigUint64(pos, false) + BigInt(delta),
                    false,
                );
            }
        } else if (containerTypes.has(box.type)) {
            updateChunkOffsets(
                newBytes,
                newView,
                box.offset + getBoxHeaderSize(box),
                box.end,
                delta,
            );
        }
    }
}



const DUMMY_SIZES = {
    avc1: 8,
    avc3: 8,
    hvc1: 16,
    hev1: 16,
    vp09: 4,
    av01: 4,
    mp4v: 8,
};
const DEFAULT_DUMMY_SIZE = 8;

function findHandlerType(bytes, hdlrBox) {
    const start = hdlrBox.offset + 8;
    const end = hdlrBox.end;
    for (let i = start; i + 4 <= end; i++) {
        if (
            bytes[i] === 0x76 &&
            bytes[i + 1] === 0x69 &&
            bytes[i + 2] === 0x64 &&
            bytes[i + 3] === 0x65
        ) {
            return "vide";
        }
    }
    return null;
}

function findVideoStbl(bytes, view, moovBox) {
    const moovChildren = parseBoxes(
        bytes,
        view,
        moovBox.offset + getBoxHeaderSize(moovBox),
        moovBox.end,
    );

    for (const trak of moovChildren.filter((b) => b.type === "trak")) {
        const trakChildren = parseBoxes(
            bytes,
            view,
            trak.offset + getBoxHeaderSize(trak),
            trak.end,
        );
        const mdiaBox = trakChildren.find((b) => b.type === "mdia");
        if (!mdiaBox) {
            console.warn("inflate: no mdia");
            continue;
        }

        const mdiaChildren = parseBoxes(
            bytes,
            view,
            mdiaBox.offset + getBoxHeaderSize(mdiaBox),
            mdiaBox.end,
        );
        const hdlrBox = mdiaChildren.find((b) => b.type === "hdlr");
        if (!hdlrBox) {
            console.warn("inflate: no hdlr");
            continue;
        }

        if (findHandlerType(bytes, hdlrBox) !== "vide") {
            console.warn("inflate: not vide track");
            continue;
        }

        const minfBox = mdiaChildren.find((b) => b.type === "minf");
        if (!minfBox) {
            console.warn("inflate: no minf");
            continue;
        }

        const minfChildren = parseBoxes(
            bytes,
            view,
            minfBox.offset + getBoxHeaderSize(minfBox),
            minfBox.end,
        );
        const stblBox = minfChildren.find((b) => b.type === "stbl");
        if (!stblBox) continue;

        return { trak, mdiaBox, minfBox, stblBox };
    }
    return null;
}

function buildSttsAtom(realCount, sampleDelta, multiplier) {
    const fakeCount = realCount * (multiplier - 1);
    const atomSize = 16 + 2 * 8;
    const buffer = new ArrayBuffer(atomSize);
    const b = new Uint8Array(buffer);
    const v = new DataView(buffer);

    v.setUint32(0, atomSize, false);
    b[4] = 0x73;
    b[5] = 0x74;
    b[6] = 0x74;
    b[7] = 0x73;
    v.setUint32(8, 0, false);
    v.setUint32(12, 2, false);
    v.setUint32(16, realCount, false);
    v.setUint32(20, sampleDelta, false);
    v.setUint32(24, fakeCount, false);
    v.setUint32(28, sampleDelta, false);

    return b;
}

function buildStszAtom(
    inputBytes,
    inputView,
    stszBox,
    realCount,
    multiplier,
    dummySize,
) {
    const totalCount = realCount * multiplier;
    const atomSize = 20 + totalCount * 4;
    const buffer = new ArrayBuffer(atomSize);
    const b = new Uint8Array(buffer);
    const v = new DataView(buffer);

    v.setUint32(0, atomSize, false);
    b[4] = 0x73;
    b[5] = 0x74;
    b[6] = 0x73;
    b[7] = 0x7a;
    v.setUint32(8, 0, false);
    v.setUint32(12, 0, false);
    v.setUint32(16, totalCount, false);

    const srcBase = stszBox.offset + 20;
    for (let i = 0; i < realCount; i++) {
        v.setUint32(
            20 + i * 4,
            inputView.getUint32(srcBase + i * 4, false),
            false,
        );
    }
    for (let i = realCount; i < totalCount; i++) {
        v.setUint32(20 + i * 4, dummySize, false);
    }

    return b;
}

function buildStcoAtom(
    inputView,
    stcoBox,
    origCount,
    realCount,
    safeOffset,
    offsetDelta,
    multiplier,
) {
    const fakeCount = realCount * (multiplier - 1);
    const newCount = origCount + fakeCount;
    const atomSize = 16 + newCount * 4;
    const buffer = new ArrayBuffer(atomSize);
    const b = new Uint8Array(buffer);
    const v = new DataView(buffer);

    v.setUint32(0, atomSize, false);
    b[4] = 0x73;
    b[5] = 0x74;
    b[6] = 0x63;
    b[7] = 0x6f;
    v.setUint32(8, 0, false);
    v.setUint32(12, newCount, false);

    const srcBase = stcoBox.offset + 16;
    for (let i = 0; i < origCount; i++) {
        v.setUint32(
            16 + i * 4,
            inputView.getUint32(srcBase + i * 4, false) + offsetDelta,
            false,
        );
    }
    for (let i = 0; i < fakeCount; i++) {
        v.setUint32(16 + (origCount + i) * 4, safeOffset, false);
    }

    return b;
}

function buildCo64Atom(
    inputView,
    co64Box,
    origCount,
    realCount,
    safeOffset,
    offsetDelta,
    multiplier,
) {
    const fakeCount = realCount * (multiplier - 1);
    const newCount = origCount + fakeCount;
    const atomSize = 16 + newCount * 8;
    const buffer = new ArrayBuffer(atomSize);
    const b = new Uint8Array(buffer);
    const v = new DataView(buffer);

    v.setUint32(0, atomSize, false);
    b[4] = 0x63;
    b[5] = 0x6f;
    b[6] = 0x36;
    b[7] = 0x34;
    v.setUint32(8, 0, false);
    v.setUint32(12, newCount, false);

    const srcBase = co64Box.offset + 16;
    const safeOffsetBig = BigInt(safeOffset);
    const offsetDeltaBig = BigInt(offsetDelta);
    for (let i = 0; i < origCount; i++) {
        v.setBigUint64(
            16 + i * 8,
            inputView.getBigUint64(srcBase + i * 8, false) + offsetDeltaBig,
            false,
        );
    }
    for (let i = 0; i < fakeCount; i++) {
        v.setBigUint64(16 + (origCount + i) * 8, safeOffsetBig, false);
    }

    return b;
}

function buildStscPatch(inputBytes, inputView, stscBox, origStcoCount) {
    const origEntryCount = inputView.getUint32(stscBox.offset + 12, false);
    const newEntryCount = origEntryCount + 1;
    const atomSize = 16 + newEntryCount * 12;
    const buffer = new ArrayBuffer(atomSize);
    const b = new Uint8Array(buffer);
    const v = new DataView(buffer);

    v.setUint32(0, atomSize, false);
    b[4] = 0x73;
    b[5] = 0x74;
    b[6] = 0x73;
    b[7] = 0x63;
    v.setUint32(8, 0, false);
    v.setUint32(12, newEntryCount, false);

    const srcBase = stscBox.offset + 16;
    for (let i = 0; i < origEntryCount; i++) {
        const fc = inputView.getUint32(srcBase + i * 12, false);
        const spc = inputView.getUint32(srcBase + i * 12 + 4, false);
        const sdi = inputView.getUint32(srcBase + i * 12 + 8, false);
        v.setUint32(16 + i * 12, fc, false);
        v.setUint32(16 + i * 12 + 4, spc, false);
        v.setUint32(16 + i * 12 + 8, sdi, false);
    }

    v.setUint32(16 + origEntryCount * 12, origStcoCount + 1, false);
    v.setUint32(16 + origEntryCount * 12 + 4, 1, false);
    v.setUint32(16 + origEntryCount * 12 + 8, 1, false);

    return b;
}

function inflateSampleTableVideo(inputBytes, inputView, multiplier = 5) {
    const fileSize = inputBytes.length;
    const topBoxes = parseBoxes(inputBytes, inputView, 0, fileSize);
    const moovBox = topBoxes.find((b) => b.type === "moov");
    if (!moovBox) throw new Error("Moov box not found");
    if (multiplier < 2) throw new Error("Multiplier < 2");

    const located = findVideoStbl(inputBytes, inputView, moovBox);
    if (!located) throw new Error("Video track not found");

    const { stblBox } = located;
    const stblChildren = parseBoxes(
        inputBytes,
        inputView,
        stblBox.offset + getBoxHeaderSize(stblBox),
        stblBox.end,
    );

    const sttsBox = stblChildren.find((b) => b.type === "stts");
    const stszBox = stblChildren.find((b) => b.type === "stsz");
    const stcoBox = stblChildren.find((b) => b.type === "stco");
    const co64Box = stblChildren.find((b) => b.type === "co64");
    const stscBox = stblChildren.find((b) => b.type === "stsc");
    if (!sttsBox || !stszBox || !stscBox)
        throw new Error("Required sample table box missing");
    if (!stcoBox && !co64Box)
        throw new Error("Chunk offset box (stco/co64) missing");

    const sttsEntryCount = inputView.getUint32(sttsBox.offset + 12, false);
    let realCount = 0;
    let totalDuration = 0;
    const sttsBase = sttsBox.offset + 16;
    for (let i = 0; i < sttsEntryCount; i++) {
        const count = inputView.getUint32(sttsBase + i * 8, false);
        const delta = inputView.getUint32(sttsBase + i * 8 + 4, false);
        realCount += count;
        totalDuration += count * delta;
    }
    if (realCount === 0) throw new Error("No video samples found");
    const sampleDelta = Math.round(totalDuration / realCount);

    const codec = detectCodecFromStbl(inputBytes, stblBox);
    const dummySize = DUMMY_SIZES[codec] || DEFAULT_DUMMY_SIZE;

    const origChunkCount = stcoBox
        ? inputView.getUint32(stcoBox.offset + 12, false)
        : inputView.getUint32(co64Box.offset + 12, false);

    const newStts = buildSttsAtom(realCount, sampleDelta, multiplier);
    const newStsz = buildStszAtom(
        inputBytes,
        inputView,
        stszBox,
        realCount,
        multiplier,
        dummySize,
    );
    const newStsc = buildStscPatch(
        inputBytes,
        inputView,
        stscBox,
        origChunkCount,
    );

    const sttsDelta = newStts.length - sttsBox.size;
    const stszDelta = newStsz.length - stszBox.size;
    const stscDelta = newStsc.length - stscBox.size;
    const fakeCount = realCount * (multiplier - 1);
    const chunkBox = stcoBox || co64Box;
    const chunkEntrySize = stcoBox ? 4 : 8;
    const chunkDelta = fakeCount * chunkEntrySize;
    const moovDelta = sttsDelta + stszDelta + stscDelta + chunkDelta;

    const safeOffset = fileSize + moovDelta;
    const newChunkBox = stcoBox
        ? buildStcoAtom(
              inputView,
              stcoBox,
              origChunkCount,
              realCount,
              safeOffset,
              moovDelta,
              multiplier,
          )
        : buildCo64Atom(
              inputView,
              co64Box,
              origChunkCount,
              realCount,
              safeOffset,
              moovDelta,
              multiplier,
          );

    const replacements = [
        { box: sttsBox, bytes: newStts },
        { box: stszBox, bytes: newStsz },
        { box: stscBox, bytes: newStsc },
        { box: chunkBox, bytes: newChunkBox },
    ].sort((a, b) => a.box.offset - b.box.offset);

    const paddingSize = fakeCount * dummySize;
    const newSize = fileSize + moovDelta + paddingSize;
    const newBuffer = new ArrayBuffer(newSize);
    const newBytes = new Uint8Array(newBuffer);
    const newView = new DataView(newBuffer);

    let readPos = 0;
    let writePos = 0;
    for (const rep of replacements) {
        newBytes.set(inputBytes.subarray(readPos, rep.box.offset), writePos);
        writePos += rep.box.offset - readPos;
        newBytes.set(rep.bytes, writePos);
        writePos += rep.bytes.length;
        readPos = rep.box.end;
    }
    newBytes.set(inputBytes.subarray(readPos, fileSize), writePos);

    updateBoxSize(newView, stblBox.offset, stblBox, moovDelta);
    updateBoxSize(newView, located.minfBox.offset, located.minfBox, moovDelta);
    updateBoxSize(newView, located.mdiaBox.offset, located.mdiaBox, moovDelta);
    updateBoxSize(newView, located.trak.offset, located.trak, moovDelta);
    updateBoxSize(newView, moovBox.offset, moovBox, moovDelta);

    const mdatBox = topBoxes.find((b) => b.type === "mdat");
    const moovBeforeMdat = mdatBox && moovBox.offset < mdatBox.offset;

    if (moovBeforeMdat) {
        const updatedMoovSize = newView.getUint32(moovBox.offset, false);
        const moovEnd = moovBox.offset + updatedMoovSize;
        const moovChildren = parseBoxes(
            newBytes,
            newView,
            moovBox.offset + getBoxHeaderSize(moovBox),
            moovEnd,
        );
        for (const trak of moovChildren.filter((b) => b.type === "trak")) {
            const trakChildren = parseBoxes(
                newBytes,
                newView,
                trak.offset + getBoxHeaderSize(trak),
                trak.end,
            );
            const mdiaBox2 = trakChildren.find((b) => b.type === "mdia");
            if (!mdiaBox2) continue;
            const mdiaChildren = parseBoxes(
                newBytes,
                newView,
                mdiaBox2.offset + getBoxHeaderSize(mdiaBox2),
                mdiaBox2.end,
            );
            const minfBox2 = mdiaChildren.find((b) => b.type === "minf");
            if (!minfBox2) continue;
            const minfChildren = parseBoxes(
                newBytes,
                newView,
                minfBox2.offset + getBoxHeaderSize(minfBox2),
                minfBox2.end,
            );
            const stblBox2 = minfChildren.find((b) => b.type === "stbl");
            if (!stblBox2 || stblBox2.offset === stblBox.offset) continue;
            const stblChildren = parseBoxes(
                newBytes,
                newView,
                stblBox2.offset + getBoxHeaderSize(stblBox2),
                stblBox2.end,
            );
            const stcoBox2 = stblChildren.find((b) => b.type === "stco");
            if (stcoBox2) {
                const count = newView.getUint32(stcoBox2.offset + 12, false);
                for (let i = 0; i < count; i++) {
                    const pos = stcoBox2.offset + 16 + i * 4;
                    newView.setUint32(
                        pos,
                        newView.getUint32(pos, false) + moovDelta,
                        false,
                    );
                }
            }
            const co64Box2 = stblChildren.find((b) => b.type === "co64");
            if (co64Box2) {
                const count = newView.getUint32(co64Box2.offset + 12, false);
                for (let i = 0; i < count; i++) {
                    const pos = co64Box2.offset + 16 + i * 8;
                    newView.setBigUint64(
                        pos,
                        newView.getBigUint64(pos, false) + BigInt(moovDelta),
                        false,
                    );
                }
            }
        }
    }

    return { newBuffer, newBytes, newView };
}



function buildFtyp(isHevc) {
    if (isHevc) {
        const ftyp = new Uint8Array(32);
        const v = new DataView(ftyp.buffer);
        v.setUint32(0, 32, false);
        ftyp.set([0x66, 0x74, 0x79, 0x70], 4);
        ftyp.set([0x69, 0x73, 0x6f, 0x34], 8);
        v.setUint32(12, 0x00000200, false);
        ftyp.set([0x69, 0x73, 0x6f, 0x6d], 16);
        ftyp.set([0x69, 0x73, 0x6f, 0x32], 20);
        ftyp.set([0x68, 0x76, 0x63, 0x31], 24);
        ftyp.set([0x6d, 0x70, 0x34, 0x31], 28);
        return ftyp;
    }
    const ftyp = new Uint8Array(28);
    const v = new DataView(ftyp.buffer);
    v.setUint32(0, 28, false);
    ftyp.set([0x66, 0x74, 0x79, 0x70], 4);
    ftyp.set([0x69, 0x73, 0x6f, 0x6d], 8);
    ftyp.set([0x00, 0x00, 0x02, 0x00], 12);
    ftyp.set([0x69, 0x73, 0x6f, 0x6d], 16);
    ftyp.set([0x69, 0x73, 0x6f, 0x32], 20);
    ftyp.set([0x6d, 0x70, 0x34, 0x31], 24);
    return ftyp;
}

function normalizeContainer(inputBytes, inputView) {
    const fileSize = inputBytes.length;
    const topBoxes = parseBoxes(inputBytes, inputView, 0, fileSize);

    const ftypBox = topBoxes.find((b) => b.type === "ftyp");
    const moovBox = topBoxes.find((b) => b.type === "moov");
    const mdatBox = topBoxes.find((b) => b.type === "mdat");

    if (!moovBox) {
        return {
            newBuffer: inputBytes.buffer,
            newBytes: inputBytes,
            newView: inputView,
            changed: false,
            valid: false,
        };
    }

    if (!mdatBox) {
        return {
            newBuffer: inputBytes.buffer,
            newBytes: inputBytes,
            newView: inputView,
            changed: false,
            valid: true,
        };
    }

    const moovBeforeMdat = moovBox.offset < mdatBox.offset;
    let needsFtypRewrite = false;
    let ftypBytes = null;

    if (ftypBox) {
        const ftypContent = inputBytes.subarray(
            ftypBox.offset + getBoxHeaderSize(ftypBox),
            ftypBox.end,
        );
        const majorBrand = String.fromCharCode(
            ftypContent[0],
            ftypContent[1],
            ftypContent[2],
            ftypContent[3],
        );
        if (majorBrand !== "isom") {
            needsFtypRewrite = true;
            const codec = detectVideoCodecFromMoov(inputBytes, inputView, moovBox);
            const isHevc = codec === "hvc1" || codec === "hev1";
            ftypBytes = buildFtyp(isHevc);
        }
    }

    if (moovBeforeMdat && !needsFtypRewrite) {
        return {
            newBuffer: inputBytes.buffer,
            newBytes: inputBytes,
            newView: inputView,
            changed: false,
            valid: true,
        };
    }

    const ftypSize =
        needsFtypRewrite && ftypBytes
            ? ftypBytes.length
            : ftypBox
              ? ftypBox.size
              : 0;
    const moovSize = moovBox.size;
    const mdatSize = mdatBox.size;
    const newSize = ftypSize + moovSize + mdatSize;

    const newBuffer = new ArrayBuffer(newSize);
    const newBytes = new Uint8Array(newBuffer);
    const newView = new DataView(newBuffer);

    let writePos = 0;

    if (needsFtypRewrite && ftypBytes) {
        newBytes.set(ftypBytes, writePos);
        writePos += ftypBytes.length;
    } else if (ftypBox) {
        newBytes.set(inputBytes.subarray(ftypBox.offset, ftypBox.end), writePos);
        writePos += ftypBox.size;
    }

    newBytes.set(inputBytes.subarray(moovBox.offset, moovBox.end), writePos);
    const newMoovOffset = writePos;
    writePos += moovBox.size;

    newBytes.set(inputBytes.subarray(mdatBox.offset, mdatBox.end), writePos);
    writePos += mdatBox.size;

    const newMdatOffset = newMoovOffset + moovBox.size;
    const chunkOffsetDelta = newMdatOffset - mdatBox.offset;

    if (chunkOffsetDelta !== 0) {
        updateChunkOffsets(
            newBytes,
            newView,
            newMoovOffset + getBoxHeaderSize({ offset: newMoovOffset, size: moovBox.size }),
            newMoovOffset + moovBox.size,
            chunkOffsetDelta,
        );
    }

    return { newBuffer, newBytes, newView, changed: true, valid: true };
}


function noblurProcess(input, multiplier){
  multiplier = Math.max(2, Math.min(50, (multiplier|0) || 10));
  var bytes = input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input);
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var norm = normalizeContainer(bytes, view);
  if(!norm || norm.valid === false) throw new Error('NoBlur: invalid MP4/MOV');
  bytes = norm.newBytes;
  view = norm.newView;
  var inflated = inflateSampleTableVideo(bytes, view, multiplier);
  if(!inflated || !inflated.newBytes) throw new Error('NoBlur: inflate failed');
  return new Uint8Array(inflated.newBytes);
}
global.noblurProcess = noblurProcess;
})(typeof window !== 'undefined' ? window : self);

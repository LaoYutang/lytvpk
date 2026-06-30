const BLOCK_SIZE = 16;
const BLOCK_SIZE_4 = 4;
const BLOCK_SIZE_4X4 = 16;
const BLOCK_SIZE_4X4X4 = 64;
const CHANNEL_SIZE_ARGB = 4;
const CMP_Speed_Normal = 1;
const CMP_Speed_Fast = 0;
var m_fChannelWeights = [];
var m_fBaseChannelWeights = [];
var m_bUseChannelWeighting = true;
var m_bUseAdaptiveWeighting = true;
var m_bSwizzleChannels = false;
var m_nCompressionSpeed = CMP_Speed_Normal;
var m_nCompressionSpeedAlpha = CMP_Speed_Normal;
const RG = 5;
const GG = 6;
const BG = 5;
var m_bUseSSE2 = false;
var m_b3DRefinement = true;
var m_nRefinementSteps = 1;
var medianR = 0.0;
var medianG = 0.0;
var medianB = 0.0;
var error = 0.0;
var step = 0.0;
var step_h = 0.0;
var rstep = 0.0;
const NUM_CHANNELS = 4;
const RGB_CHANNELS = 3;
const NUM_ENDPOINTS = 2;
const MAX_BLOCK = 16;
const MAX_POINTS = 16;
const AC = 3
const RC = 2
const GC = 1
const BC = 0
const PIX_GRID = 8;
const FLT_MAX = Number.MAX_VALUE;
const FLT_MIN = Number.MIN_VALUE;
const CE_OK = 0;
const CE_Aborted = 2;
const CE_Unknown = 1;
const EPS = (2 / 255.0) * (2.0 / 255.0)
const EPS2 = 3 * (2.0 / 255.0) * (2.0 / 255.0)
const MAX_ERROR = 128000;
const GBL_SCH_STEP_MXS =0.018
const GBL_SCH_EXT_MXS =0.1
const LCL_SCH_STEP_MXS =0.6
const  GBL_SCH_STEP_MXQ =0.0175
const  GBL_SCH_EXT_MXQ =0.154
const  LCL_SCH_STEP_MXQ =0.45

const  GBL_SCH_STEP =GBL_SCH_STEP_MXS
const  GBL_SCH_EXT  =GBL_SCH_EXT_MXS
const  LCL_SCH_STEP =LCL_SCH_STEP_MXS

var m_nRefinementStepsAlpha = 3; 
m_fChannelWeights[0] = m_fBaseChannelWeights[0] = 0.3086;
m_fChannelWeights[1] = m_fBaseChannelWeights[1] = 0.6094;
m_fChannelWeights[2] = m_fBaseChannelWeights[2] = 0.0820;
const nByteBitsMask =
    [
        0x00,
        0x80,
        0xc0,
        0xe0,
        0xf0,
        0xf8,
        0xfc,
        0xfe,
        0xff,
    ]

var Fctrsr = new Float32Array(3);
Fctrsr[RC] = (1 << RG);
Fctrsr[GC] = (1 << GG);
Fctrsr[BC] = (1 << BG);

var Fctrs = new Float32Array(3);
Fctrs[RC] = (1 << (PIX_GRID - RG));
Fctrs[GC] = (1 << (PIX_GRID - GG));
Fctrs[BC] = (1 << (PIX_GRID - BG));

var Rpt = new Float32Array(BLOCK_SIZE);
var BlkIn = new Float32Array(BLOCK_SIZE * NUM_CHANNELS);
var dwBlk = new Float32Array(BLOCK_SIZE);
var InpRmp = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
var nEndpoints1 = new Uint8Array(RGB_CHANNELS * NUM_ENDPOINTS);
var nEndpoints2 = new Uint8Array(RGB_CHANNELS * NUM_ENDPOINTS);
var nIndices1 = new Uint8Array(BLOCK_SIZE_4X4);
var nIndices2 = new Uint8Array(BLOCK_SIZE_4X4);
var nEndpoints = new Uint8Array(RGB_CHANNELS * NUM_ENDPOINTS);
var nIndices = new Uint8Array(BLOCK_SIZE_4X4);
var Blk = new Float32Array(MAX_BLOCK * NUM_CHANNELS);
var rsltC = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
var dwBlkU = new Int32Array(BLOCK_SIZE);
var InpRmp = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
var Rmp = new Float32Array(NUM_CHANNELS * MAX_POINTS);
var Prj0 = new Float32Array(MAX_BLOCK);
var Prj = new Float32Array(MAX_BLOCK);
var PrjErr = new Float32Array(MAX_BLOCK);
var LineDir = new Float32Array(NUM_CHANNELS);
var RmpIndxs = new Float32Array(MAX_BLOCK);

var LineDirG = new Float32Array(NUM_CHANNELS);
var PosG = new Float32Array(NUM_ENDPOINTS);
var Blk = new Float32Array(MAX_BLOCK * NUM_CHANNELS);
var BlkSh = new Float32Array(MAX_BLOCK * NUM_CHANNELS);
var LineDir0 = new Float32Array(NUM_CHANNELS);
var Mdl = new Float32Array(NUM_CHANNELS);

var rsltC = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
var PrjBnd = new Float32Array(NUM_ENDPOINTS);

var BlkPr1 = new Uint8Array(MAX_BLOCK * NUM_CHANNELS);
var BlkPr2 = new Uint8Array(MAX_BLOCK * NUM_CHANNELS);

var BlkPrAlpha1 = new Uint8Array(MAX_BLOCK);
var BlkPrAlpha2 = new Uint8Array(MAX_BLOCK);
//align16 float
var PreMRep = new Float32Array(MAX_BLOCK);


function ConstructColour(r, g, b) { return (((r) << 11) | ((g) << 5) | (b)) }

function toUnsigned(value) {
    if (value >= 0)
        return value;
    else
        return value + 4294967296;
}
function memset(arr, value) {
    var dim = Array.isArray(arr[0]);
    if (dim)
        for (var i = 0; i < arr.length; i++) {
            memset(arr[i], value);
        }
    else
        for (var i = 0; i < arr.length; i++) {
            arr[i] = value;
        }
}
function createArray(length) {
    var arr = new Array(length || 0),
        i = length;

    if (arguments.length > 1) {
        var args = Array.prototype.slice.call(arguments, 1);
        while (i--) arr[length - 1 - i] = createArray.apply(this, args);
    }

    return arr;
}

function QSortIntCmp(Elem1, Elem2) {
    return (Elem1 - Elem2);
}

function Compress(bufferIn, bufferOut, pFeedbackProc, pUser1, pUser2) {
    assert(bufferIn.GetWidth() == bufferOut.GetWidth());
    assert(bufferIn.GetHeight() == bufferOut.GetHeight());

    if (bufferIn.GetWidth() != bufferOut.GetWidth() || bufferIn.GetHeight() != bufferOut.GetHeight())
        return CE_Unknown;

    const dwBlocksX = ((bufferIn.GetWidth() + 3) >>> 2);
    const dwBlocksY = ((bufferIn.GetHeight() + 3) >>> 2);

    var bUseFixed = (!bufferIn.IsFloat() && bufferIn.GetChannelDepth() == 8 && !m_bUseFloat);

    var fAlphaThreshold = CONVERT_BYTE_TO_FLOAT(m_nAlphaThreshold);
    for (var j = 0; j < dwBlocksY; j++) {
        for (var i = 0; i < dwBlocksX; i++) {
            var compressedBlock = createArray(2);
            if (bUseFixed) {
                var srcBlock = createArray(BLOCK_SIZE_4X4X4);
                bufferIn.ReadBlockRGBA(i * 4, j * 4, 4, 4, srcBlock);
                CompressRGBBlock(srcBlock, compressedBlock, CalculateColourWeightings(srcBlock), true, m_bDXT1UseAlpha, m_nAlphaThreshold);
            }
            else {
                var srcBlock = createArray(BLOCK_SIZE_4X4X4);
                bufferIn.ReadBlockRGBA(i * 4, j * 4, 4, 4, srcBlock);
                CompressRGBBlock(srcBlock, compressedBlock, CalculateColourWeightings(srcBlock), true, m_bDXT1UseAlpha, fAlphaThreshold);
            }
            bufferOut.WriteBlock(i * 4, j * 4, compressedBlock, 2);
        }
        if (pFeedbackProc) {
            var fProgress = 100.0 * (j * dwBlocksX) / (dwBlocksX * dwBlocksY);
            if (pFeedbackProc(fProgress, pUser1, pUser2))
                return CE_Aborted;
        }
    }

    return CE_OK;
}

function CalculateColourWeightings(block) {
    if (!m_bUseChannelWeighting)
        return NULL;

    if (m_bUseAdaptiveWeighting) {
        medianR = 0.0, medianG = 0.0, medianB = 0.0;

        for (var k = 0; k < BLOCK_SIZE_4X4; k++) {
            var R = (block[k] & 0xff0000) >>> 16;
            var G = (block[k] & 0xff00) >>> 8;
            var B = block[k] & 0xff;

            medianR += R;
            medianG += G;
            medianB += B;
        }

        medianR /= BLOCK_SIZE_4X4;
        medianG /= BLOCK_SIZE_4X4;
        medianB /= BLOCK_SIZE_4X4;

        // Now skew the colour weightings based on the gravity center of the block
        var largest = Math.max(Math.max(medianR, medianG), medianB);

        if (largest > 0) {
            medianR /= largest;
            medianG /= largest;
            medianB /= largest;
        }
        else
            medianR = medianG = medianB = 1.0;

        // Scale weightings back up to 1.0f
        var fWeightScale = 1.0 / (m_fBaseChannelWeights[0] + m_fBaseChannelWeights[1] + m_fBaseChannelWeights[2]);
        m_fChannelWeights[0] = m_fBaseChannelWeights[0] * fWeightScale;
        m_fChannelWeights[1] = m_fBaseChannelWeights[1] * fWeightScale;
        m_fChannelWeights[2] = m_fBaseChannelWeights[2] * fWeightScale;
        m_fChannelWeights[0] = ((m_fChannelWeights[0] * 3 * medianR) + m_fChannelWeights[0]) * 0.25;
        m_fChannelWeights[1] = ((m_fChannelWeights[1] * 3 * medianG) + m_fChannelWeights[1]) * 0.25;
        m_fChannelWeights[2] = ((m_fChannelWeights[2] * 3 * medianB) + m_fChannelWeights[2]) * 0.25;
        fWeightScale = 1.0 / (m_fChannelWeights[0] + m_fChannelWeights[1] + m_fChannelWeights[2]);
        m_fChannelWeights[0] *= fWeightScale;
        m_fChannelWeights[1] *= fWeightScale;
        m_fChannelWeights[2] *= fWeightScale;
    }

    return m_fChannelWeights;
}

//byte[], dword[], float, bool, bool
function CompressRGBBlock(rgbBlock, compressedBlock, pfChannelWeights, bDXT1, bDXT1UseAlpha, nDXT1AlphaThreshold, blkPrv) {
    /*
    ARGB Channel indexes
    */

    var RC = 2, GC = 1, BC = 0;

    if (m_bSwizzleChannels) {
        RC = 0; GC = 1; BC = 2;
    }

    if (bDXT1 && m_nCompressionSpeed == CMP_Speed_Normal) {
        //byte, byte
        var nEndpointsl, nIndicesl;
        //rgb, num
        // var nEndpoints1 = new Uint8Array(RGB_CHANNELS * NUM_ENDPOINTS);
        // var nEndpoints2 = new Uint8Array(RGB_CHANNELS * NUM_ENDPOINTS);
        // var nIndices1 = new Uint8Array(BLOCK_SIZE_4X4);
        // var nIndices2 = new Uint8Array(BLOCK_SIZE_4X4);
        //double
        if (bDXT1UseAlpha){
            BlkPr1.fill(0);
            BlkPr2.fill(0);
        }
        else {
            for (var i = 0; i < 16; i++){
                BlkPr1[i*4]=0;
                BlkPr1[i*4+1]=0;
                BlkPr1[i*4+2]=0;
                BlkPr1[i*4+3]=(rgbBlock[i]>>>24);
                BlkPr2[i*4]=0;
                BlkPr2[i*4+1]=0;
                BlkPr2[i*4+2]=0;
                BlkPr2[i*4+3]=(rgbBlock[i]>>>24);
            }
        }
        var fError3 = CompRGBBlock(rgbBlock, BLOCK_SIZE_4X4, RG, GG, BG, nEndpoints1, nIndices1, 3, m_bUseSSE2, m_b3DRefinement, m_nRefinementSteps, pfChannelWeights, bDXT1UseAlpha, nDXT1AlphaThreshold, BlkPr1);
        var fError4 = (fError3 == 0.0) ? FLT_MAX : CompRGBBlock(rgbBlock, BLOCK_SIZE_4X4, RG, GG, BG, nEndpoints2, nIndices2, 4, m_bUseSSE2, m_b3DRefinement, m_nRefinementSteps, pfChannelWeights, bDXT1UseAlpha, nDXT1AlphaThreshold, BlkPr2);

        //uint
        var nMethod = fError3 <= fError4;
        if (nMethod) {
            nEndpointsl = nEndpoints1;
            nIndicesl = nIndices1;
            blkPrv.set(BlkPr1);
        }
        else {
            nEndpointsl = nEndpoints2;
            nIndicesl = nIndices2;
            blkPrv.set(BlkPr2);
        }

        var c0 = ConstructColour((nEndpointsl[RC * NUM_ENDPOINTS] >>> (8 - RG)), (nEndpointsl[GC * NUM_ENDPOINTS] >>> (8 - GG)), (nEndpointsl[BC * NUM_ENDPOINTS] >>> (8 - BG)));
        var c1 = ConstructColour((nEndpointsl[RC * NUM_ENDPOINTS + 1] >>> (8 - RG)), (nEndpointsl[GC * NUM_ENDPOINTS + 1] >>> (8 - GG)), (nEndpointsl[BC * NUM_ENDPOINTS + 1] >>> (8 - BG)));
        if (!nMethod && c0 <= c1 || nMethod && c0 > c1)
            compressedBlock[0] = (c1 | (c0 << 16));
        else
            compressedBlock[0] = (c0 | (c1 << 16));

        compressedBlock[1] = 0;
        for (var i = 0; i < 16; i++)
            compressedBlock[1] = compressedBlock[1] | (nIndicesl[i] << (2 * i));
    }
    else {
        //byte
        //var nEndpoints = new Uint8Array(RGB_CHANNELS * NUM_ENDPOINTS);
        //var nIndices = new Uint8Array(BLOCK_SIZE_4X4);
        if (bDXT1UseAlpha){
            blkPrv.fill(0);
        }
        else {
            for (var i = 0; i < 16; i++){
                blkPrv[i*4]=0;
                blkPrv[i*4+1]=0;
                blkPrv[i*4+2]=0;
                blkPrv[i*4+3]=(rgbBlock[i]>>>24);
            }
        }
        CompRGBBlock(rgbBlock, BLOCK_SIZE_4X4, RG, GG, BG, nEndpoints, nIndices, 4, m_bUseSSE2, m_b3DRefinement, m_nRefinementSteps, pfChannelWeights, bDXT1UseAlpha, nDXT1AlphaThreshold, blkPrv);

        //uint
        var c0 = ConstructColour((nEndpoints[RC * NUM_ENDPOINTS] >>> (8 - RG)), (nEndpoints[GC * NUM_ENDPOINTS] >>> (8 - GG)), (nEndpoints[BC * NUM_ENDPOINTS] >>> (8 - BG)));
        var c1 = ConstructColour((nEndpoints[RC * NUM_ENDPOINTS + 1] >>> (8 - RG)), (nEndpoints[GC * NUM_ENDPOINTS + 1] >>> (8 - GG)), (nEndpoints[BC * NUM_ENDPOINTS + 1] >>> (8 - BG)));
        if (c0 <= c1)
            compressedBlock[0] = c1 | (c0 << 16);
        else
            compressedBlock[0] = c0 | (c1 << 16);

        compressedBlock[1] = 0;
        for (var i = 0; i < 16; i++)
            compressedBlock[1] = compressedBlock[1] | (nIndices[i] << (2 * i));
    }

    return CE_OK;
}

//dword[], word, byte,byte,byte,byte[], byte[], byte, bool, bool, bool, float[], bool, byte
function CompRGBBlock(block_32, dwBlockSize,
    nRedBits, nGreenBits, nBlueBits,
    nEndpoints, pcIndices, dwNumPoints,
    _bUseSSE2, b3DRefinement, nRefinementSteps, _pfChannelWeights,
    _bUseAlpha, _nAlphaThreshold, blkPrv) {
    //align 16 float
    /*Rpt = new Float32Array(BLOCK_SIZE);
    BlkIn = new Float32Array(BLOCK_SIZE * NUM_CHANNELS);*/

    memset(Rpt, 0);
    memset(BlkIn, 0);
    //dword
    var dwAlphaThreshold = _nAlphaThreshold;
    var dwColors = 0;
    //var dwBlk = new Float32Array(BLOCK_SIZE);
    for (var i = 0; i < dwBlockSize; i++)
        if (!_bUseAlpha || (block_32[i] >>> 24) >= dwAlphaThreshold)
            dwBlk[dwColors++] = block_32[i] | 0xff000000;

    // Do we have any colors ?
    if (dwColors) {
        var bHasAlpha = (dwColors != dwBlockSize);
        if (bHasAlpha && _bUseAlpha && !(dwNumPoints & 0x1))
            return FLT_MAX;

        // Here we are computing an unique number of colors.
        // For each unique value we compute the number of it appearences.
        dwBlk.sort(QSortIntCmp);
        //qsort((void *)dwBlk, (size_t)dwColors, sizeof(CMP_DWORD), QSortIntCmp);

        //dword
        var new_p;
        //var dwBlkU = new Int32Array(BLOCK_SIZE);
        var dwUniqueColors = 0;
        new_p = dwBlkU[0] = dwBlk[0];
        Rpt[dwUniqueColors] = 1.0;
        for (var i = 1; i < dwColors; i++) {
            if (new_p != dwBlk[i]) {
                dwUniqueColors++;
                new_p = dwBlkU[dwUniqueColors] = dwBlk[i];
                Rpt[dwUniqueColors] = 1.0;
            }
            else
                Rpt[dwUniqueColors] += 1.0;
        }
        dwUniqueColors++;

        // switch to float
        //dword
        for (var i = 0; i < dwUniqueColors; i += 1) {
            BlkIn[i * 4 + RC] = ((dwBlkU[i] >>> 16) & 0xff); // R
            BlkIn[i * 4 + GC] = ((dwBlkU[i] >>> 8) & 0xff); // G
            BlkIn[i * 4 + BC] = ((dwBlkU[i] >>> 0) & 0xff); // B
            BlkIn[i * 4 + AC] = 255.0; // A
        }

        //var rsltC = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);

        CompressRGBBlockX(rsltC, BlkIn, Rpt, dwUniqueColors, dwNumPoints, b3DRefinement, nRefinementSteps,
            _pfChannelWeights, nRedBits, nGreenBits, nBlueBits);

        // return to integer realm
        for (var i = 0; i < 3 * NUM_ENDPOINTS; i += 2)
            for (var j = 0; j < 2; j++)
                nEndpoints[i + j] = rsltC[i + j] & 255;

        return Clstr(block_32, dwBlockSize, nEndpoints, pcIndices, dwNumPoints, _pfChannelWeights, _bUseAlpha,
            _nAlphaThreshold, nRedBits, nGreenBits, nBlueBits, blkPrv);
    }
    else {
        // All colors transparent
        nEndpoints[0] = nEndpoints[2] = nEndpoints[4] = 0;
        nEndpoints[1] = nEndpoints[3] = nEndpoints[5] = 0xff;
         
        
        memset(pcIndices, 0xff/*, dwBlockSize*/);
        return 0.0;
    }
}

function ConstructColor(R, nRedBits, G, nGreenBits, B, nBlueBits) {
    return (((R & nByteBitsMask[nRedBits]) << (nGreenBits + nBlueBits - (PIX_GRID - nRedBits))) |
        ((G & nByteBitsMask[nGreenBits]) << (nBlueBits - (PIX_GRID - nGreenBits))) |
        ((B & nByteBitsMask[nBlueBits]) >>> ((PIX_GRID - nBlueBits))));
}

function Clstr(block_32, dwBlockSize, nEndpoints, pcIndices, dwNumPoints,
    _pfWeights, _bUseAlpha, _nAlphaThreshold,
    nRedBits, nGreenBits, nBlueBits, blkPrv
) {
    var c0 = ConstructColor(nEndpoints[RC * 2], nRedBits, nEndpoints[GC * 2], nGreenBits, nEndpoints[BC * 2], nBlueBits);
    var c1 = ConstructColor(nEndpoints[RC * 2 + 1], nRedBits, nEndpoints[GC * 2 + 1], nGreenBits, nEndpoints[BC * 2 + 1], nBlueBits);
    var nEndpointIndex0 = 0;
    var nEndpointIndex1 = 1;
    if ((!(dwNumPoints & 0x1) && c0 <= c1) || ((dwNumPoints & 0x1) && c0 > c1)) {
        nEndpointIndex0 = 1;
        nEndpointIndex1 = 0;
    }

    //var InpRmp = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
    InpRmp[RC * 2] = nEndpoints[RC * 2 + nEndpointIndex0];
    InpRmp[RC * 2 + 1] = nEndpoints[RC * 2 + nEndpointIndex1];
    InpRmp[GC * 2] = nEndpoints[GC * 2 + nEndpointIndex0];
    InpRmp[GC * 2 + 1] = nEndpoints[GC * 2 + nEndpointIndex1];
    InpRmp[BC * 2] = nEndpoints[BC * 2 + nEndpointIndex0];
    InpRmp[BC * 2 + 1] = nEndpoints[BC * 2 + nEndpointIndex1];

    var dwAlphaThreshold = _nAlphaThreshold;
    for (var i = 0; i < dwBlockSize; i++) {
        Blk[i * 4 + RC] = ((block_32[i] & 0xff0000) >>> 16);
        Blk[i * 4 + GC] = ((block_32[i] & 0xff00) >>> 8);
        Blk[i * 4 + BC] = (block_32[i] & 0xff);
        if (_bUseAlpha)
            Blk[i * 4 + AC] = (block_32[i] >>> 24) >= dwAlphaThreshold ? 1.0 : 0.0;
    }

    return ClstrBas(pcIndices, Blk, InpRmp, dwBlockSize, dwNumPoints, _pfWeights, _bUseAlpha, nRedBits, nGreenBits, nBlueBits, blkPrv);
}

function ClstrBas(_Indxs, _Blk, _InpRmp, dwBlockSize, dwNumPoints, _pfWeights,
    _bUseAlpha, nRedBits, nGreenBits, nBlueBits, blkPrv) {
    // make ramp endpoints the way they'll going to be decompressed
    var Eq = true;
    //var InpRmp = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
    Eq = MkWkRmpPts(Eq, InpRmp, _InpRmp, nRedBits, nGreenBits, nBlueBits);

    // build ramp as it would be built by decompressor
    //var Rmp = new Float32Array(NUM_CHANNELS * MAX_POINTS);
    BldRmp(Rmp, InpRmp, dwNumPoints);

    // clusterize and find a cumulative error
    return ClstrIntnl(_Blk, _Indxs, Rmp, dwBlockSize, dwNumPoints, Eq, _pfWeights, _bUseAlpha, blkPrv);
}

function ClstrIntnl(_Blk, _Indxs,
    _Rmp, dwBlockSize, dwNumPoints,
    _ConstRamp, _pfWeights, _bUseAlpha, blkPrv) {
    var Err = 0;
    var rmp_l = (_ConstRamp) ? 1 : dwNumPoints;

    // For each colour in the original block assign it
    // to the closest cluster and compute the cumulative error
    for (var i = 0; i < dwBlockSize; i++) {
        if (_bUseAlpha && _Blk[i * 4 + AC] == 0){
            _Indxs[i] = dwNumPoints;
            blkPrv[i * 4+ RC]=0;
            blkPrv[i * 4+ GC]=0;
            blkPrv[i * 4+ BC]=0;
            if(_bUseAlpha)
                blkPrv[i * 4+ AC]=0;
        }
        else {
            var shortest = 99999999999.0;
            var shortestIndex = 0;
            if (_pfWeights)
                for (var r = 0; r < rmp_l; r++) {
                    // calculate the distance for each component
                    var distance = (_Blk[i * 4 + RC] - _Rmp[RC * 16 + r]) * (_Blk[i * 4 + RC] - _Rmp[RC * 16 + r]) * _pfWeights[0] +
                        (_Blk[i * 4 + GC] - _Rmp[GC * 16 + r]) * (_Blk[i * 4 + GC] - _Rmp[GC * 16 + r]) * _pfWeights[1] +
                        (_Blk[i * 4 + BC] - _Rmp[BC * 16 + r]) * (_Blk[i * 4 + BC] - _Rmp[BC * 16 + r]) * _pfWeights[2];

                    if (distance < shortest) {
                        shortest = distance;
                        shortestIndex = r;
                    }
                }
            else
                for (var r = 0; r < rmp_l; r++) {
                    // calculate the distance for each component
                    var distance = (_Blk[i * 4 + RC] - _Rmp[RC * 16 + r]) * (_Blk[i * 4 + RC] - _Rmp[RC * 16 + r]) +
                        (_Blk[i * 16 + GC] - _Rmp[GC * 16 + r]) * (_Blk[i * 4 + GC] - _Rmp[GC * 16 + r]) +
                        (_Blk[i * 16 + BC] - _Rmp[BC * 16 + r]) * (_Blk[i * 4 + BC] - _Rmp[BC * 16 + r]);

                    if (distance < shortest) {
                        shortest = distance;
                        shortestIndex = r;
                    }
                }

            
            blkPrv[i * 4+ RC]=_Rmp[RC * 16 + shortestIndex];
            blkPrv[i * 4+ GC]=_Rmp[GC * 16 + shortestIndex];
            blkPrv[i * 4+ BC]=_Rmp[BC * 16 + shortestIndex];
            if(_bUseAlpha)
                blkPrv[i * 4+ AC]=255;
            Err += shortest;
            // We have the index of the best cluster, so assign this in the block
            // Reorder indices to match correct DXTC ordering
            if (shortestIndex == dwNumPoints - 1)
                shortestIndex = 1;
            else if (shortestIndex)
                shortestIndex++;
            _Indxs[i] = shortestIndex;
        }
    }

    return Err;
}

//float[], float[], float[], int, byte, bool, byte, float[], byte, byte, byte
function CompressRGBBlockX(_RsltRmpPnts, _BlkIn, _Rpt, _UniqClrs, dwNumPoints, b3DRefinement, nRefinementSteps, _pfWeights,
    nRedBits, nGreenBits, nBlueBits) {
    //align 16 float
    /*var Prj0 = Prj0;
    var Prj = Prj;
    var PrjErr = PrjErr;
    var LineDir = LineDir;
    var RmpIndxs = RmpIndxs;

    var LineDirG = LineDirG;
    var PosG = PosG;
    var Blk = Blk;
    var BlkSh = BlkSh;
    var LineDir0 = LineDir0;
    var Mdl = Mdl;

    var rsltC = rsltC;*/
    var i, j, k;

    // down to [0., 1.]
    for (i = 0; i < _UniqClrs * 4; i += 4)
        for (j = 0; j < 3; j++)
            Blk[i + j] = _BlkIn[i + j] / 255.0;

    var isDONE = false;

    // as usual if not more then 2 different colors, we've done 
    if (_UniqClrs <= 2) {
        for (j = 0; j < 3; j++) {
            rsltC[j * 2] = _BlkIn[j];
            rsltC[j * 2 + 1] = _BlkIn[(_UniqClrs - 1) * 4 + j];
        }
        isDONE = true;
    }

    if (!isDONE) {
        //    This is our first attempt to find an axis we will go along.
        //    The cumulation is done to find a line minimizing the MSE from the input 3D points.
        var bSmall = FindAxis(BlkSh, LineDir0, Mdl,/* ref*/true, Blk, _Rpt, 3, _UniqClrs);

        //    While trying to find the axis we found that the diameter of the input set is quite small.
        //    Do not bother.
        if (bSmall) {
            for (j = 0; j < 3; j++) {
                rsltC[j * 2 + 0] = _BlkIn[0 * 4 + j];
                rsltC[j * 2 + 1] = _BlkIn[(_UniqClrs - 1) * 4 + j];
            }
            isDONE = true;
        }
    }

    // GCC is being an awful being when it comes to goto-jumps.
    // So please bear with this.
    if (!isDONE) {
        var ErrG = 10000000.0;
        //var PrjBnd = new Float32Array(NUM_ENDPOINTS);
        //align16 float
        //var PreMRep = new Float32Array(MAX_BLOCK);
        for (j = 0; j < 3; j++)
            LineDir[j] = LineDir0[j];

        //    Here is the main loop.
        //    1. Project input set on the axis in consideration.
        //    2. Run 1 dimensional search (see scalar case) to find an (sub) optimal pair of end points.
        //    3. Compute the vector of indexes (or clusters) for the current approximate ramp.
        //    4. Present our color channels as 3 16DIM vectors.
        //    5. Find closest approximation of each of 16DIM color vector with the projection of the 16DIM index vector.
        //    6. Plug the projections as a new directional vector for the axis.
        //    7. Goto 1.

        //    D - is 16 dim "index" vector (or 16 DIM vector of indexes - {0, 1/3, 2/3, 0, ...,}, but shifted and normalized).
        //    Ci - is a 16 dim vector of color i.
        //    for each Ci find a scalar Ai such that
        //    (Ai * D - Ci) (Ai * D - Ci) -> min , i.e distance between vector AiD and C is min.
        //    You can think of D as a unit interval(vector) "clusterizer",
        //    and Ai is a scale you need to apply to the clusterizer to 
        //    approximate the Ci vector instead of the unit vector.

        //    Solution is 

        //    Ai = (D . Ci) / (D . D); . - is a dot product.

        //    in 3 dim space Ai(s) represent a line direction, along which
        //    we again try to find (sub)optimal quantizer.

        //    That's what our for(;;) loop is about.
        for (; ;) {
            //  1. Project input set on the axis in consideration.
            // From Foley & Van Dam: Closest point of approach of a line (P + v) to a point (R) is
            //                            P + ((R-P).v) / (v.v))v
            // The distance along v is therefore (R-P).v / (v.v)
            // (v.v) is 1 if v is a unit vector.
            //
            PrjBnd[0] = 1000.;
            PrjBnd[1] = -1000.;
            for (i = 0; i < MAX_BLOCK; i++)
                Prj0[i] = Prj[i] = PrjErr[i] = PreMRep[i] = 0.0;

            for (i = 0; i < _UniqClrs; i++) {
                Prj0[i] = Prj[i] = BlkSh[i * 4 + 0] * LineDir[0] + BlkSh[i * 4 + 1] * LineDir[1] + BlkSh[i * 4 + 2] * LineDir[2];

                PrjErr[i] = (BlkSh[i * 4 + 0] - LineDir[0] * Prj[i]) * (BlkSh[i * 4 + 0] - LineDir[0] * Prj[i])
                    + (BlkSh[i * 4 + 1] - LineDir[1] * Prj[i]) * (BlkSh[i * 4 + 1] - LineDir[1] * Prj[i])
                    + (BlkSh[i * 4 + 2] - LineDir[2] * Prj[i]) * (BlkSh[i * 4 + 2] - LineDir[2] * Prj[i]);

                PrjBnd[0] = Math.min(PrjBnd[0], Prj[i]);
                PrjBnd[1] = Math.max(PrjBnd[1], Prj[i]);
            }

            //  2. Run 1 dimensional search (see scalar case) to find an (sub) optimal pair of end points.

            // min and max of the search interval
            //float
            var Scl = new Float32Array(NUM_ENDPOINTS);
            Scl[0] = PrjBnd[0] - (PrjBnd[1] - PrjBnd[0]) * 0.125;;
            Scl[1] = PrjBnd[1] + (PrjBnd[1] - PrjBnd[0]) * 0.125;;

            // compute scaling factor to scale down the search interval to [0.,1] 
            const Scl2 = (Scl[1] - Scl[0]) * (Scl[1] - Scl[0]);
            const overScl = 1 / (Scl[1] - Scl[0]);

            for (i = 0; i < _UniqClrs; i++) {
                // scale them
                Prj[i] = (Prj[i] - Scl[0]) * overScl;
                // premultiply the scale squire to plug into error computation later
                PreMRep[i] = _Rpt[i] * Scl2;
            }

            // scale first approximation of end points
            for (k = 0; k < 2; k++)
                PrjBnd[k] = (PrjBnd[k] - Scl[0]) * overScl;

            var Err = MAX_ERROR;

            // search step

            //static const CODECFLOAT stp = 0.025f;
            var stp = 0.025;
            // low Start/End; high Start/End
            var lS = (PrjBnd[0] - 2.0 * stp > 0) ? PrjBnd[0] - 2.0 * stp : 0.0;
            var hE = (PrjBnd[1] + 2.0 * stp < 1.0) ? PrjBnd[1] + 2.0 * stp : 1.0;

            // find the best endpoints 
            //float
            var Pos = new Float32Array(NUM_ENDPOINTS);
            var lP, hP;
            //int
            var l, h;
            for (l = 0, lP = lS; l < 8; l++ , lP += stp) {
                for (h = 0, hP = hE; h < 8; h++ , hP -= stp) {
                    //float
                    var err = Err;
                    // compute an error for the current pair of end points.
                    err = RampSrchW(Prj, PrjErr, PreMRep, err, lP, hP, _UniqClrs, dwNumPoints);

                    if (err < Err) {
                        // save better result
                        Err = err;
                        Pos[0] = lP;
                        Pos[1] = hP;
                    }
                }
            }

            // inverse the scaling
            for (k = 0; k < 2; k++)
                Pos[k] = Pos[k] * (Scl[1] - Scl[0]) + Scl[0];

            // did we find somthing better from the previous run?
            if (Err + 0.001 < ErrG) {
                // yes, remember it
                ErrG = Err;
                LineDirG[0] = LineDir[0];
                LineDirG[1] = LineDir[1];
                LineDirG[2] = LineDir[2];
                PosG[0] = Pos[0];
                PosG[1] = Pos[1];
                //  3. Compute the vector of indexes (or clusters) for the current approximate ramp.
                // indexes
                const step = (Pos[1] - Pos[0]) / (dwNumPoints - 1);
                const step_h = step * 0.5;
                const rstep = 1.0 / step;
                const overBlkTp = 1.0 / (dwNumPoints - 1);

                // here the index vector is computed, 
                // shifted and normalized
                var indxAvrg = (dwNumPoints - 1) / 2.0;

                for (i = 0; i < _UniqClrs; i++) {
                    var del;
                    //int n = (int)((b - _min_ex + (step*0.5f)) * rstep);
                    if ((del = Prj0[i] - Pos[0]) <= 0)
                        RmpIndxs[i] = 0.0;
                    else if (Prj0[i] - Pos[1] >= 0)
                        RmpIndxs[i] = (dwNumPoints - 1);
                    else
                        RmpIndxs[i] = Math.floor((del + step_h) * rstep);
                    // shift and normalization
                    RmpIndxs[i] = (RmpIndxs[i] - indxAvrg) * overBlkTp;
                }

                //  4. Present our color channels as 3 16DIM vectors.
                //  5. Find closest aproximation of each of 16DIM color vector with the pojection of the 16DIM index vector.
                var Crs = new Float32Array(3), Len, Len2;
                for (i = 0, Crs[0] = Crs[1] = Crs[2] = Len = 0.0; i < _UniqClrs; i++) {
                    const PreMlt = RmpIndxs[i] * _Rpt[i];
                    Len += RmpIndxs[i] * PreMlt;
                    for (j = 0; j < 3; j++)
                        Crs[j] += BlkSh[i * 4 + j] * PreMlt;
                }

                LineDir[0] = LineDir[1] = LineDir[2] = 0.0;
                if (Len > 0.0) {
                    LineDir[0] = Crs[0] / Len;
                    LineDir[1] = Crs[1] / Len;
                    LineDir[2] = Crs[2] / Len;

                    //  6. Plug the projections as a new directional vector for the axis.
                    //  7. Goto 1.
                    Len2 = LineDir[0] * LineDir[0] + LineDir[1] * LineDir[1] + LineDir[2] * LineDir[2];
                    Len2 = Math.sqrt(Len2);

                    LineDir[0] /= Len2;
                    LineDir[1] /= Len2;
                    LineDir[2] /= Len2;
                }
            }
            else // We was not able to find anything better.  Drop dead.
                break;
        }

        // inverse transform to find end-points of 3-color ramp
        for (k = 0; k < 2; k++)
            for (j = 0; j < 3; j++)
                rsltC[j * 2 + k] = (PosG[k] * LineDirG[j] + Mdl[j]) * 255.0;
    }

    // We've dealt with (almost) unrestricted full precision realm.
    // Now back to the dirty digital world.

    // round the end points to make them look like compressed ones
    var inpRmpEndPts = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
    MkRmpOnGrid(inpRmpEndPts, rsltC, 0.0, 255.0, nRedBits, nGreenBits, nBlueBits);

    //    This not a small procedure squeezes and stretches the ramp along each axis (R,G,B) separately while other 2 are fixed.
    //    It does it only over coarse grid - 565 that is. It tries to squeeze more precision for the real world ramp.
    if (b3DRefinement)
        Refine3D(_RsltRmpPnts, inpRmpEndPts, _BlkIn, _Rpt, _UniqClrs, dwNumPoints, _pfWeights, nRedBits, nGreenBits, nBlueBits, nRefinementSteps);
    else
        Refine(_RsltRmpPnts, inpRmpEndPts, _BlkIn, _Rpt, _UniqClrs, dwNumPoints, _pfWeights, nRedBits, nGreenBits, nBlueBits, nRefinementSteps);
}
//float[], float[], float[], p bool, float[], float[], int, int


function FindAxis(_outBlk, fLineDirection,
    fBlockCenter, _pbSmall, _inpBlk,
    _inpRpt, nDimensions, nNumColors) {
    var Crrl = new Float32Array(NUM_CHANNELS);
    var RGB2 = new Float32Array(NUM_CHANNELS);

    fLineDirection[0] = fLineDirection[1] = fLineDirection[2] = RGB2[0] = RGB2[1] = RGB2[2] =
        Crrl[0] = Crrl[1] = Crrl[2] = fBlockCenter[0] = fBlockCenter[1] = fBlockCenter[2] = 0;

    // sum position of all points
    var fNumPoints = 0;
    for (var i = 0; i < nNumColors; i++) {
        fBlockCenter[0] += _inpBlk[i * 4 + 0] * _inpRpt[i];
        fBlockCenter[1] += _inpBlk[i * 4 + 1] * _inpRpt[i];
        fBlockCenter[2] += _inpBlk[i * 4 + 2] * _inpRpt[i];
        fNumPoints += _inpRpt[i];
    }

    // and then average to calculate center coordinate of block
    fBlockCenter[0] /= fNumPoints;
    fBlockCenter[1] /= fNumPoints;
    fBlockCenter[2] /= fNumPoints;

    for (var i = 0; i < nNumColors; i++) {
        // calculate output block as offsets around block center
        _outBlk[i * 4 + 0] = _inpBlk[i * 4 + 0] - fBlockCenter[0];
        _outBlk[i * 4 + 1] = _inpBlk[i * 4 + 1] - fBlockCenter[1];
        _outBlk[i * 4 + 2] = _inpBlk[i * 4 + 2] - fBlockCenter[2];

        // compute correlation matrix
        // RGB2 = sum of ((distance from point from center) squared)
        // Crrl = ???????. Seems to be be some calculation based on distance from point center in two dimensions
        for (var j = 0; j < nDimensions; j++) {
            RGB2[j] += _outBlk[i * 4 + j] * _outBlk[i * 4 + j] * _inpRpt[i];
            Crrl[j] += _outBlk[i * 4 + j] * _outBlk[i * 4 + (j + 1) % 3] * _inpRpt[i];
        }
    }

    // if set's diameter is small 
    var i0 = 0, i1 = 1;
    var mxRGB2 = 0;
    var k = 0, j = 0;
    var fEPS = fNumPoints * EPS;
    for (k = 0, j = 0; j < 3; j++) {
        if (RGB2[j] >= fEPS)
            k++;
        else
            RGB2[j] = 0.0;

        if (mxRGB2 < RGB2[j]) {
            mxRGB2 = RGB2[j];
            i0 = j;
        }
    }

    var fEPS2 = fNumPoints * EPS2;
    _pbSmall = true;
    for (j = 0; j < 3; j++)
        _pbSmall &= (RGB2[j] < fEPS2);

    if (_pbSmall) // all are very small to avoid division on the small determinant
        return true;

    if (k == 1) // really only 1 dimension
        fLineDirection[i0] = 1.;
    else if (k == 2) // really only 2 dimensions
    {
        i1 = (RGB2[(i0 + 1) % 3] > 0.0) ? (i0 + 1) % 3 : (i0 + 2) % 3;
        var Crl = (i1 == (i0 + 1) % 3) ? Crrl[i0] : Crrl[(i0 + 2) % 3];
        fLineDirection[i1] = Crl / RGB2[i0];
        fLineDirection[i0] = 1.;
    }
    else {
        var maxDet = 100000.0;
        var Cs = new Float32Array(3);
        // select max det for precision
        for (j = 0; j < nDimensions; j++) {
            var Det = RGB2[j] * RGB2[(j + 1) % 3] - Crrl[j] * Crrl[j];
            Cs[j] = Math.abs(Crrl[j] / Math.sqrt(RGB2[j] * RGB2[(j + 1) % 3]));
            if (maxDet < Det) {
                maxDet = Det;
                i0 = j;
            }
        }

        // inverse correl matrix
        //  --      --       --      --
        //  |  A   B |       |  C  -B |
        //  |  B   C |  =>   | -B   A |
        //  --      --       --     --
        var mtrx1 = new Float32Array(2 * 2);
        var vc1 = new Float32Array(2);
        var vc = new Float32Array(2);
        vc1[0] = Crrl[(i0 + 2) % 3];
        vc1[1] = Crrl[(i0 + 1) % 3];
        // C
        mtrx1[0] = RGB2[(i0 + 1) % 3];
        // A
        mtrx1[3] = RGB2[i0];
        // -B
        mtrx1[2] = mtrx1[1] = -Crrl[i0];
        // find a solution
        vc[0] = mtrx1[0] * vc1[0] + mtrx1[1] * vc1[1];
        vc[1] = mtrx1[2] * vc1[0] + mtrx1[3] * vc1[1];
        // normalize
        vc[0] /= maxDet;
        vc[1] /= maxDet;
        // find a line direction vector
        fLineDirection[i0] = 1.;
        fLineDirection[(i0 + 1) % 3] = 1.;
        fLineDirection[(i0 + 2) % 3] = vc[0] + vc[1];
    }

    // normalize direction vector
    var Len = fLineDirection[0] * fLineDirection[0] + fLineDirection[1] * fLineDirection[1] + fLineDirection[2] * fLineDirection[2];
    Len = Math.sqrt(Len);

    for (j = 0; j < 3; j++)
        fLineDirection[j] = (Len > 0.0) ? fLineDirection[j] / Len : 0.0;
    return _pbSmall;
}



function RampSrchW(_Blck,
    _BlckErr,
    _Rpt,
    _maxerror, _min_ex, _max_ex,
    _NmbClrs,
    _block) {
    error = 0;
    step = (_max_ex - _min_ex) / (_block - 1);
    step_h = step * 0.5;
    rstep = 1.0 / step;

    for (var i = 0; i < _NmbClrs; i++) {
        var v;
        // Work out which value in the block this select
        var del;

        if ((del = _Blck[i] - _min_ex) <= 0)
            v = _min_ex;
        else if (_Blck[i] - _max_ex >= 0)
            v = _max_ex;
        else
            v = Math.floor((del + step_h) * rstep) * step + _min_ex;

        // And accumulate the error
        var d = (_Blck[i] - v);
        d *= d;
        var err = _Rpt[i] * d + _BlckErr[i];
        error += err;
        if (_maxerror < error) {
            error = _maxerror;
            break;
        }
    }
    return error;
}

function MkRmpOnGrid(_RmpF, _MnMx,
    _Min, _Max, nRedBits, nGreenBits, nBlueBits) {
    var Fctrs0 = Fctrs;
    var Fctrs1 = Fctrsr;

    for (var j = 0; j < 3; j++) {
        for (var k = 0; k < 2; k++) {
            _RmpF[j * 2 + k] = Math.floor(_MnMx[j * 2 + k]);
            if (_RmpF[j * 2 + k] <= _Min)
                _RmpF[j * 2 + k] = _Min;
            else {
                _RmpF[j * 2 + k] += Math.floor(128.0 / Fctrs1[j]) - Math.floor(_RmpF[j * 2 + k] / Fctrs1[j]);
                _RmpF[j * 2 + k] = Math.min(_RmpF[j * 2 + k], _Max);
            }

            _RmpF[j * 2 + k] = Math.floor(_RmpF[j * 2 + k] / Fctrs0[j]) * Fctrs0[j];
        }
    }
}

function Refine3D(_OutRmpPnts,
    _InpRmpPnts,
    _Blk, _Rpt,
    _NmrClrs, dwNumPoints, _pfWeights,
    nRedBits, nGreenBits, nBlueBits, nRefineSteps) {
    var Rmp = new Float32Array(NUM_CHANNELS * MAX_POINTS);

    var Blk = new Float32Array(MAX_BLOCK * NUM_CHANNELS);
    for (var i = 0; i < _NmrClrs; i++)
        for (var j = 0; j < 3; j++)
            Blk[i * 4 + j] = _Blk[i * 4 + j];

    var fWeightRed = _pfWeights ? _pfWeights[0] : 1.0;
    var fWeightGreen = _pfWeights ? _pfWeights[1] : 1.0;
    var fWeightBlue = _pfWeights ? _pfWeights[2] : 1.0;

    // here is our gri

    var InpRmp0 = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
    var InpRmp = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
    for (var k = 0; k < 2; k++)
        for (var j = 0; j < 3; j++)
            InpRmp0[j * 2 + k] = InpRmp[j * 2 + k] = _OutRmpPnts[j * 2 + k] = _InpRmpPnts[j * 2 + k];

    // make ramp endpoints the way they'll going to be decompressed
    // plus check whether the ramp is flat
    var Eq;
    var WkRmpPts = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
    //eq ptr
    Eq = MkWkRmpPts(Eq, WkRmpPts, InpRmp, nRedBits, nGreenBits, nBlueBits);

    // build ramp for all 3 colors
    BldRmp(Rmp, WkRmpPts, dwNumPoints);

    // clusterize for the current ramp
    var bestE = ClstrErr(Blk, _Rpt, Rmp, _NmrClrs, dwNumPoints, Eq, _pfWeights);
    if (bestE == 0 || !nRefineSteps)    // if exact, we've done
        return bestE;

    // Jitter endpoints in each direction
    var nRefineStart = 0 - (Math.min(nRefineSteps, 8));
    var nRefineEnd = Math.min(nRefineSteps, 8);
    for (var nJitterG0 = nRefineStart; nJitterG0 <= nRefineEnd; nJitterG0++) {
        InpRmp[GC * 2 + 0] = Math.min(Math.max(InpRmp0[GC * 2 + 0] + nJitterG0 * Fctrs[GC], 0.0), 255.0);
        for (var nJitterG1 = nRefineStart; nJitterG1 <= nRefineEnd; nJitterG1++) {
            InpRmp[GC * 2 + 1] = Math.min(Math.max(InpRmp0[GC * 2 + 1] + nJitterG1 * Fctrs[GC], 0.0), 255.0);
            Eq = MkWkRmpPts(Eq, WkRmpPts, InpRmp, nRedBits, nGreenBits, nBlueBits);
            BldClrRmp(Rmp, WkRmpPts, dwNumPoints, GC);

            var RmpErrG = new Float32Array(MAX_POINTS * MAX_BLOCK);
            for (var i = 0; i < _NmrClrs; i++) {
                for (var r = 0; r < dwNumPoints; r++) {
                    var DistG = (Rmp[GC * 16 + r] - Blk[i * 4 + GC]);
                    RmpErrG[r * 64 + i] = DistG * DistG * fWeightGreen;
                }
            }

            for (var nJitterB0 = nRefineStart; nJitterB0 <= nRefineEnd; nJitterB0++) {
                InpRmp[BC * 2 + 0] = Math.min(Math.max(InpRmp0[BC * 2 + 0] + nJitterB0 * Fctrs[BC], 0.0), 255.0);
                for (var nJitterB1 = nRefineStart; nJitterB1 <= nRefineEnd; nJitterB1++) {
                    InpRmp[BC * 2 + 1] = Math.min(Math.max(InpRmp0[BC * 2 + 1] + nJitterB1 * Fctrs[BC], 0.0), 255.0);
                    Eq = MkWkRmpPts(Eq, WkRmpPts, InpRmp, nRedBits, nGreenBits, nBlueBits);
                    BldClrRmp(Rmp, WkRmpPts, dwNumPoints, BC);

                    var RmpErr = new Float32Array(MAX_POINTS * MAX_BLOCK);
                    for (var i = 0; i < _NmrClrs; i++) {
                        for (var r = 0; r < dwNumPoints; r++) {
                            var DistB = (Rmp[BC * 16 + r] - Blk[i * 4 + BC]);
                            RmpErr[r * 64 + i] = RmpErrG[r * 64 + i] + DistB * DistB * fWeightBlue;
                        }
                    }

                    for (var nJitterR0 = nRefineStart; nJitterR0 <= nRefineEnd; nJitterR0++) {
                        InpRmp[RC * 2 + 0] = Math.min(Math.max(InpRmp0[RC * 2 + 0] + nJitterR0 * Fctrs[RC], 0.0), 255.0);
                        for (var nJitterR1 = nRefineStart; nJitterR1 <= nRefineEnd; nJitterR1++) {
                            InpRmp[RC * 2 + 1] = Math.min(Math.max(InpRmp0[RC * 2 + 1] + nJitterR1 * Fctrs[RC], 0.0), 255.0);
                            Eq = MkWkRmpPts(Eq, WkRmpPts, InpRmp, nRedBits, nGreenBits, nBlueBits);
                            BldClrRmp(Rmp, WkRmpPts, dwNumPoints, RC);

                            // compute cumulative error
                            var mse = 0.0;
                            var rmp_l = (Eq) ? 1 : dwNumPoints;
                            for (var k = 0; k < _NmrClrs; k++) {
                                var MinErr = 10000000.0;
                                for (var r = 0; r < rmp_l; r++) {
                                    var Dist = (Rmp[RC * 16 + r] - Blk[k * 4 + RC]);
                                    var Err = RmpErr[r * 64 + k] + Dist * Dist * fWeightRed;
                                    MinErr = Math.min(MinErr, Err);
                                }
                                mse += MinErr * _Rpt[k];
                            }

                            // save if we achieve better result
                            if (mse < bestE) {
                                bestE = mse;
                                for (var k = 0; k < 2; k++)
                                    for (var j = 0; j < 3; j++)
                                        _OutRmpPnts[j * 2 + k] = InpRmp[j * 2 + k];
                            }
                        }
                    }
                }
            }
        }
    }

    return bestE;
}

//p bool
function MkWkRmpPts(_bEq, _OutRmpPts, _InpRmpPts, nRedBits, nGreenBits, nBlueBits) {

    _bEq = true;
    // find whether input ramp is flat
    for (var j = 0; j < 3; j++)
        _bEq &= (_InpRmpPts[j * 2 + 0] == _InpRmpPts[j * 2 + 1]);

    // end points on the integer grid
    for (var j = 0; j < 3; j++) {
        for (var k = 0; k < 2; k++) {
            // Apply the lower bit replication to give full dynamic range
            _OutRmpPts[j * 2 + k] = _InpRmpPts[j * 2 + k] + Math.floor(_InpRmpPts[j * 2 + k] / Fctrsr[j]);
            _OutRmpPts[j * 2 + k] = Math.max(_OutRmpPts[j * 2 + k], 0.0);
            _OutRmpPts[j * 2 + k] = Math.min(_OutRmpPts[j * 2 + k], 255.0);
        }
    }
    return _bEq;
}

var dwRndAmount = [0, 0, 0, 0, 1, 1, 2, 2, 3];

/*------------------------------------------------------------------------------------------------
1 DIM ramp 
------------------------------------------------------------------------------------------------*/
function BldClrRmp(_Rmp, _InpRmp, dwNumPoints, channel) {
    // linear interpolate end points to get the ramp 
    _Rmp[channel * 16] = _InpRmp[channel * 2];
    _Rmp[(channel * 16) + dwNumPoints - 1] = _InpRmp[(channel * 2) + 1];
    if (dwNumPoints % 2)
        _Rmp[(channel * 16) + dwNumPoints] = 1000000.0; // for 3 point ramp; not to select the 4th point as min
    for (var e = 1; e < dwNumPoints - 1; e++)
        _Rmp[(channel * 16) + e] = Math.floor((_Rmp[(channel * 16)] * (dwNumPoints - 1 - e) + _Rmp[(channel * 16) + dwNumPoints - 1] * e + dwRndAmount[dwNumPoints]) / (dwNumPoints - 1));
}

function BldRmp(_Rmp, _InpRmp, dwNumPoints) {
    for (var j = 0; j < 3; j++)
        BldClrRmp(_Rmp, _InpRmp, dwNumPoints, j);
}

var sMvF = [0.0, -1.0, 1.0, -2.0, 2.0, -3.0, 3.0, -4.0, 4.0, -5.0, 5.0, -6.0, 6.0, -7.0, 7.0, -8.0, 8.0];

function Refine(_OutRmpPnts, _InpRmpPnts, _Blk, _Rpt, _NmrClrs, dwNumPoints, _pfWeights, nRedBits, nGreenBits, nBlueBits, nRefineSteps) {
    //align16
    var Rmp = new Float32Array(NUM_CHANNELS * MAX_POINTS);

    var Blk = new Float32Array(MAX_BLOCK * NUM_CHANNELS);
    for (var i = 0; i < _NmrClrs; i++)
        for (var j = 0; j < 3; j++)
            Blk[i * 4 + j] = _Blk[i * 4 + j];

    var fWeightRed = _pfWeights ? _pfWeights[0] : 1.0;
    var fWeightGreen = _pfWeights ? _pfWeights[1] : 1.0;
    var fWeightBlue = _pfWeights ? _pfWeights[2] : 1.0;

    // here is our grid


    var InpRmp0 = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
    var InpRmp = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
    for (var k = 0; k < 2; k++)
        for (var j = 0; j < 3; j++)
            InpRmp0[j * 2 + k] = InpRmp[j * 2 + k] = _OutRmpPnts[j * 2 + k] = _InpRmpPnts[j * 2 + k];

    // make ramp endpoints the way they'll going to be decompressed
    // plus check whether the ramp is flat
    var Eq;
    var WkRmpPts = new Float32Array(NUM_CHANNELS * NUM_ENDPOINTS);
    Eq = MkWkRmpPts(Eq, WkRmpPts, InpRmp, nRedBits, nGreenBits, nBlueBits);

    // build ramp for all 3 colors
    BldRmp(Rmp, WkRmpPts, dwNumPoints);

    // clusterize for the current ramp
    var bestE = ClstrErr(Blk, _Rpt, Rmp, _NmrClrs, dwNumPoints, Eq, _pfWeights);
    if (bestE == 0.0 || !nRefineSteps)    // if exact, we've done
        return bestE;

    // Tweak each component in isolation and get the best values

    // precompute ramp errors for Green and Blue
    var RmpErr = new Float32Array(MAX_POINTS * MAX_BLOCK);
    for (var i = 0; i < _NmrClrs; i++) {
        for (var r = 0; r < dwNumPoints; r++) {
            var DistG = (Rmp[GC * 16 + r] - Blk[i * 4 + GC]);
            var DistB = (Rmp[BC * 16 + r] - Blk[i * 4 + BC]);
            RmpErr[r * 64 + i] = DistG * DistG * fWeightGreen + DistB * DistB * fWeightBlue;
        }
    }

    // First Red
    var bstC0 = InpRmp0[RC * 2 + 0];
    var bstC1 = InpRmp0[RC * 2 + 1];
    var nRefineStart = 0 - (Math.min(nRefineSteps, 8));
    var nRefineEnd = Math.min(nRefineSteps, 8);
    for (var i = nRefineStart; i <= nRefineEnd; i++) {
        for (var j = nRefineStart; j <= nRefineEnd; j++) {
            // make a move; both sides of interval.        
            InpRmp[RC * 2 + 0] = Math.min(Math.max(InpRmp0[RC * 2 + 0] + i * Fctrs[RC], 0.0), 255.0);
            InpRmp[RC * 2 + 1] = Math.min(Math.max(InpRmp0[RC * 2 + 1] + j * Fctrs[RC], 0.0), 255.0);

            // make ramp endpoints the way they'll going to be decompressed
            // plus check whether the ramp is flat
            Eq = MkWkRmpPts(Eq, WkRmpPts, InpRmp, nRedBits, nGreenBits, nBlueBits);

            // build ramp only for red
            BldClrRmp(Rmp, WkRmpPts, dwNumPoints, RC);

            // compute cumulative error
            var mse = 0.0;
            var rmp_l = (Eq) ? 1 : dwNumPoints;
            for (var k = 0; k < _NmrClrs; k++) {
                var MinErr = 10000000.0;
                for (var r = 0; r < rmp_l; r++) {
                    var Dist = (Rmp[RC * 16 + r] - Blk[k * 4 + RC]);
                    var Err = RmpErr[r * 64 + k] + Dist * Dist * fWeightRed;
                    MinErr = Math.min(MinErr, Err);
                }
                mse += MinErr * _Rpt[k];
            }

            // save if we achieve better result
            if (mse < bestE) {
                bstC0 = InpRmp[RC * 2 + 0];
                bstC1 = InpRmp[RC * 2 + 1];
                bestE = mse;
            }
        }
    }

    // our best REDs
    InpRmp[RC * 2 + 0] = bstC0;
    InpRmp[RC * 2 + 1] = bstC1;

    // make ramp endpoints the way they'll going to be decompressed
    // plus check whether the ramp is flat
    Eq = MkWkRmpPts(Eq, WkRmpPts, InpRmp, nRedBits, nGreenBits, nBlueBits);

    // build ramp only for green
    BldRmp(Rmp, WkRmpPts, dwNumPoints);

    // precompute ramp errors for Red and Blue
    for (var i = 0; i < _NmrClrs; i++) {
        for (var r = 0; r < dwNumPoints; r++) {
            var DistR = (Rmp[RC * 16 + r] - Blk[i * 4 + RC]);
            var DistB = (Rmp[BC * 16 + r] - Blk[i * 4 + BC]);
            RmpErr[r * 64 + i] = DistR * DistR * fWeightRed + DistB * DistB * fWeightBlue;
        }
    }

    // Now green
    bstC0 = InpRmp0[GC * 2 + 0];
    bstC1 = InpRmp0[GC * 2 + 1];
    for (var i = nRefineStart; i <= nRefineEnd; i++) {
        for (var j = nRefineStart; j <= nRefineEnd; j++) {
            InpRmp[GC * 2 + 0] = Math.min(Math.max(InpRmp0[GC * 2 + 0] + i * Fctrs[GC], 0.0), 255.0);
            InpRmp[GC * 2 + 1] = Math.min(Math.max(InpRmp0[GC * 2 + 1] + j * Fctrs[GC], 0.0), 255.0);

            Eq = MkWkRmpPts(Eq, WkRmpPts, InpRmp, nRedBits, nGreenBits, nBlueBits);
            BldClrRmp(Rmp, WkRmpPts, dwNumPoints, GC);

            var mse = 0.0;
            var rmp_l = (Eq) ? 1 : dwNumPoints;
            for (var k = 0; k < _NmrClrs; k++) {
                var MinErr = 10000000.0;
                for (var r = 0; r < rmp_l; r++) {
                    var Dist = (Rmp[GC * 16 + r] - Blk[k * 4 + GC]);
                    var Err = RmpErr[r * 64 + k] + Dist * Dist * fWeightGreen;
                    MinErr = Math.min(MinErr, Err);
                }
                mse += MinErr * _Rpt[k];
            }

            if (mse < bestE) {
                bstC0 = InpRmp[GC * 2 + 0];
                bstC1 = InpRmp[GC * 2 + 1];
                bestE = mse;
            }
        }
    }

    // our best GREENs
    InpRmp[GC * 2 + 0] = bstC0;
    InpRmp[GC * 2 + 1] = bstC1;

    Eq = MkWkRmpPts(Eq, WkRmpPts, InpRmp, nRedBits, nGreenBits, nBlueBits);
    BldRmp(Rmp, WkRmpPts, dwNumPoints);

    // ramp err for Red and Green
    for (var i = 0; i < _NmrClrs; i++) {
        for (var r = 0; r < dwNumPoints; r++) {
            var DistR = (Rmp[RC * 16 + r] - Blk[i * 4 + RC]);
            var DistG = (Rmp[GC * 16 + r] - Blk[i * 4 + GC]);
            RmpErr[r * 64 + i] = DistR * DistR * fWeightRed + DistG * DistG * fWeightGreen;
        }
    }

    bstC0 = InpRmp0[BC * 2 + 0];
    bstC1 = InpRmp0[BC * 2 + 1];
    // Now blue
    for (var i = nRefineStart; i <= nRefineEnd; i++) {
        for (var j = nRefineStart; j <= nRefineEnd; j++) {
            InpRmp[BC * 2 + 0] = Math.min(Math.max(InpRmp0[BC * 2 + 0] + i * Fctrs[BC], 0.0), 255.0);
            InpRmp[BC * 2 + 1] = Math.min(Math.max(InpRmp0[BC * 2 + 1] + j * Fctrs[BC], 0.0), 255.0);

            Eq = MkWkRmpPts(Eq, WkRmpPts, InpRmp, nRedBits, nGreenBits, nBlueBits);
            BldClrRmp(Rmp, WkRmpPts, dwNumPoints, BC);

            var mse = 0.0;
            var rmp_l = (Eq) ? 1 : dwNumPoints;
            for (var k = 0; k < _NmrClrs; k++) {
                var MinErr = 10000000.0;
                for (var r = 0; r < rmp_l; r++) {
                    var Dist = (Rmp[BC * 16 + r] - Blk[k * 4 + BC]);
                    var Err = RmpErr[r * 64 + k] + Dist * Dist * fWeightBlue;
                    MinErr = Math.min(MinErr, Err);
                }
                mse += MinErr * _Rpt[k];
            }

            if (mse < bestE) {
                bstC0 = InpRmp[BC * 2 + 0];
                bstC1 = InpRmp[BC * 2 + 1];
                bestE = mse;
            }
        }
    }

    // our best BLUEs
    InpRmp[BC * 2 + 0] = bstC0;
    InpRmp[BC * 2 + 1] = bstC1;

    // return our best choice
    for (var j = 0; j < 3; j++)
        for (var k = 0; k < 2; k++)
            _OutRmpPnts[j * 2 + k] = InpRmp[j * 2 + k];

    return bestE;
}

function ClstrErr(_Blk, _Rpt,
    _Rmp, _NmbClrs, _blcktp,
    _ConstRamp, _pfWeights) {
    var fError = 0.0;
    var rmp_l = (_ConstRamp) ? 1 : _blcktp;

    // For each colour in the original block, find the closest cluster
    // and compute the comulative error
    for (var i = 0; i < _NmbClrs; i++) {
        var fShortest = 99999999999.0;

        if (_pfWeights)
            for (var r = 0; r < rmp_l; r++) {
                // calculate the distance for each component
                var fDistance = (_Blk[i * 4 + RC] - _Rmp[RC * 16 + r]) * (_Blk[i * 4 + RC] - _Rmp[RC * 16 + r]) * _pfWeights[0] +
                    (_Blk[i * 4 + GC] - _Rmp[GC * 16 + r]) * (_Blk[i * 4 + GC] - _Rmp[GC * 16 + r]) * _pfWeights[1] +
                    (_Blk[i * 4 + BC] - _Rmp[BC * 16 + r]) * (_Blk[i * 4 + BC] - _Rmp[BC * 16 + r]) * _pfWeights[2];

                if (fDistance < fShortest)
                    fShortest = fDistance;
            }
        else
            for (var r = 0; r < rmp_l; r++) {
                // calculate the distance for each component
                var fDistance = (_Blk[i * 4 + RC] - _Rmp[RC * 16 + r]) * (_Blk[i * 4 + RC] - _Rmp[RC * 16 + r]) +
                    (_Blk[i * 4 + GC] - _Rmp[GC * 16 + r]) * (_Blk[i * 4 + GC] - _Rmp[GC * 16 + r]) +
                    (_Blk[i * 4 + BC] - _Rmp[BC * 16 + r]) * (_Blk[i * 4 + BC] - _Rmp[BC * 16 + r]);

                if (fDistance < fShortest)
                    fShortest = fDistance;
            }

        // accumulate the error
        fError += fShortest * _Rpt[i];
    }

    return fError;
}

//byte[], int[]
function CompressAlphaBlock(alphaBlock, compressedBlock,blkPrv) {

    if (m_nCompressionSpeedAlpha == CMP_Speed_Normal) {
        var nEndpoints1 = new Uint8Array(2);
        var nIndices1 = new Uint8Array(BLOCK_SIZE_4X4);
        var nEndpoints2 = new Uint8Array(2);
        var nIndices2 = new Uint8Array(BLOCK_SIZE_4X4);

        var fError8 = CompBlock1X(alphaBlock, BLOCK_SIZE_4X4, nEndpoints1, nIndices1, 8, false, m_bUseSSE2, 8, 0, true,BlkPr1);
        var fError6 = (fError8 == 0.0) ? FLT_MAX : CompBlock1X(alphaBlock, BLOCK_SIZE_4X4, nEndpoints2, nIndices2, 6, true, m_bUseSSE2, 8, 0, true,BlkPr2);
        if (fError8 <= fError6){
            EncodeAlphaBlock(compressedBlock, nEndpoints1, nIndices1);
            blkPrv.set(BlkPr1);
        }
        else {
            EncodeAlphaBlock(compressedBlock, nEndpoints2, nIndices2);
            blkPrv.set(BlkPr2);
        }
    }
    else {
        var nEndpoints = new Uint8Array(2);
        var nIndices = new Uint8Array(BLOCK_SIZE_4X4);
        var fError8 = CompBlock1X(alphaBlock, BLOCK_SIZE_4X4, nEndpoints, nIndices, 8, false, m_bUseSSE2, 8, 0, true,blkPrv);
            EncodeAlphaBlock(compressedBlock, nEndpoints, nIndices);
    }
    return CE_OK;
}

function CompBlock1X(_Blk, dwBlockSize, nEndpoints, pcIndices,
    dwNumPoints, bFixedRampPoints, _bUseSSE2, _intPrec, _fracPrec, _bFixedRamp,blkPrv) {
    // convert the input and call the float equivalent.
    var fBlk = new Float32Array(BLOCK_SIZE_4X4);
    for (var i = 0; i < dwBlockSize; i++)
        fBlk[i] = _Blk[i] / 255.0;

    var err = CompBlock1XF(fBlk, dwBlockSize, nEndpoints, pcIndices, dwNumPoints, bFixedRampPoints, _bUseSSE2, _intPrec, _fracPrec, _bFixedRamp,blkPrv);
    return err;
}

function CompBlock1XF(_Blk, dwBlockSize, nEndpoints, pcIndices,
    dwNumPoints, bFixedRampPoints, _bUseSSE2, _intPrec, _fracPrec, _bFixedRamp,blkPrv) {
    // just to make them initialized
    if (!_bFixedRamp) {
        _intPrec = 8;
        _fracPrec = 0;
    }

    // this one makes the bulk of the work
    var Ramp = new Float32Array(NUM_ENDPOINTS);
    CompBlock1(Ramp, _Blk, dwBlockSize, dwNumPoints, bFixedRampPoints, _intPrec, _fracPrec, _bFixedRamp, _bUseSSE2);

    // final clusterization applied
    var fError = Clstr1(pcIndices, _Blk, Ramp, dwBlockSize, dwNumPoints, bFixedRampPoints, _intPrec, _fracPrec, _bFixedRamp,blkPrv);
    //to byte convert
    nEndpoints[0] = Ramp[0] & 255;
    nEndpoints[1] = Ramp[1] & 255;

    return fError;
}

function Clstr1(pcIndices, _blockIn, _ramp,
    _NmbrClrs, nNumPoints, bFixedRampPoints, _intPrec, _fracPrec, _bFixedRamp,blkPrv) {
    var Err = 0.0;
    var alpha = new Float32Array(MAX_POINTS);

    for (var i = 0; i < _NmbrClrs; i++)
        pcIndices[i] = 0;

    if (_ramp[0] == _ramp[1])
        return Err;

    if (!_bFixedRamp) {
        _intPrec = 8;
        _fracPrec = 0;
    }

    GetRmp1(alpha, _ramp, nNumPoints, bFixedRampPoints, _intPrec, _fracPrec, _bFixedRamp);

    if (bFixedRampPoints)
        nNumPoints += 2;

    const OverIntFctr = 1.0 / ((1 << _intPrec) - 1.0);
    for (var i = 0; i < nNumPoints; i++)
        alpha[i] *= OverIntFctr;

    // For each colour in the original block, calculate its weighted
    // distance from each point in the original and assign it
    // to the closest cluster
    for (var i = 0; i < _NmbrClrs; i++) {
        var shortest = 10000000.0;

        // Get the original alpha
        var acur = _blockIn[i];

        for (var j = 0; j < nNumPoints; j++) {
            var adist = (acur - alpha[j]);
            adist *= adist;

            if (adist < shortest) {
                shortest = adist;
                pcIndices[i] = j;
            }
        }
        blkPrv[i*4+3] = alpha[pcIndices[i]]*255;
        Err += shortest;
    }

    return Err;
}

function CompBlock1(_RmpPnts, _Blk, _Nmbr,
    dwNumPoints, bFixedRampPoints,
    _IntPrc, _FracPrc, _bFixedRamp, _bUseSSE2) {
    var fMaxError = 0.;

    var Ramp = new Float32Array(NUM_ENDPOINTS);

    var IntFctr = (1 << _IntPrc);
    //    CODECFLOAT FracFctr = (1 << _FracPrc);

    var afUniqueValues = new Float32Array(BLOCK_SIZE_4X4);
    var afValueRepeats = new Float32Array(BLOCK_SIZE_4X4);
    // For each unique value we compute the number of it appearances.
    var fBlk = new Float32Array(BLOCK_SIZE_4X4);
    fBlk.set(_Blk);

    // sort the input
    fBlk.sort(QSortIntCmp);
    //qsort((void *)fBlk, (size_t)_Nmbr, sizeof, QSortFCmp);

    var new_p = -2.;

    var N0s = 0, N1s = 0;
    var dwUniqueValues = 0;
    afUniqueValues[0] = 0.;

    var requiresCalculation = true;

    if (bFixedRampPoints) {
        for (var i = 0; i < _Nmbr; i++) {
            if (new_p != fBlk[i]) {
                new_p = fBlk[i];
                if (new_p <= 1.5 / 255.)
                    N0s++;
                else if (new_p >= 253.5 / 255.)
                    N1s++;
                else {
                    afUniqueValues[dwUniqueValues] = fBlk[i];
                    afValueRepeats[dwUniqueValues] = 1.;
                    dwUniqueValues++;
                }
            }
            else if (dwUniqueValues > 0 && afUniqueValues[dwUniqueValues - 1] == new_p)
                afValueRepeats[dwUniqueValues - 1] += 1.;
        }

        // if number of unique colors is less or eq 2 we've done either, but we know that we may have 0s and/or 1s as well. 
        // To avoid for the ramp to be considered flat we invented couple entries on the way.
        if (dwUniqueValues <= 2) {
            if (dwUniqueValues == 2) // if 2, take them
            {
                Ramp[0] = Math.floor(afUniqueValues[0] * (IntFctr - 1) + 0.5);
                Ramp[1] = Math.floor(afUniqueValues[1] * (IntFctr - 1) + 0.5);
            }
            else if (dwUniqueValues == 1) // if 1, add another one
            {
                Ramp[0] = Math.floor(afUniqueValues[0] * (IntFctr - 1) + 0.5);
                Ramp[1] = Ramp[0] + 1.;
            }
            else // if 0, invent them 
            {
                Ramp[0] = 128.;
                Ramp[1] = Ramp[0] + 1.;
            }

            fMaxError = 0.;
            requiresCalculation = false;
        }
    }
    else {
        for (var i = 0; i < _Nmbr; i++) {
            if (new_p != fBlk[i]) {
                afUniqueValues[dwUniqueValues] = new_p = fBlk[i];
                afValueRepeats[dwUniqueValues] = 1.;
                dwUniqueValues++;
            }
            else
                afValueRepeats[dwUniqueValues - 1] += 1.;
        }

        // if number of unique colors is less or eq 2, we've done 
        if (dwUniqueValues <= 2) {
            Ramp[0] = Math.floor(afUniqueValues[0] * (IntFctr - 1) + 0.5);
            if (dwUniqueValues == 1)
                Ramp[1] = Ramp[0] + 1.;
            else
                Ramp[1] = Math.floor(afUniqueValues[1] * (IntFctr - 1) + 0.5);
            fMaxError = 0.;
            requiresCalculation = false;
        }
    }

    if (requiresCalculation) {
        var min_ex = afUniqueValues[0];
        var max_ex = afUniqueValues[dwUniqueValues - 1];
        var min_bnd = 0, max_bnd = 1.;
        var min_r = min_ex, max_r = max_ex;
        var gbl_l = 0, gbl_r = 0;
        var cntr = (min_r + max_r) / 2;

        var gbl_err = MAX_ERROR;
        // Trying to avoid unnecessary calculations. Heuristics: after some analisis it appears 
        // that in integer case, if the input interval not more then 48 we won't get much better

        var wantsSearch = !(_bFixedRamp && _FracPrc == 0 && max_ex - min_ex <= 48. / IntFctr);

        if (wantsSearch) {
            // Search.
            // 1. take the vicinities of both low and high bound of the input interval.
            // 2. setup some search step
            // 3. find the new low and high bound which provides an (sub) optimal (infinite precision) clusterization.
            var gbl_llb = (min_bnd > min_r - GBL_SCH_EXT) ? min_bnd : min_r - GBL_SCH_EXT;
            var gbl_rrb = (max_bnd < max_r + GBL_SCH_EXT) ? max_bnd : max_r + GBL_SCH_EXT;
            var gbl_lrb = (cntr < min_r + GBL_SCH_EXT) ? cntr : min_r + GBL_SCH_EXT;
            var gbl_rlb = (cntr > max_r - GBL_SCH_EXT) ? cntr : max_r - GBL_SCH_EXT;
            for (var step_l = gbl_llb; step_l < gbl_lrb; step_l += GBL_SCH_STEP) {
                for (var step_r = gbl_rrb; gbl_rlb <= step_r; step_r -= GBL_SCH_STEP) {
                    var sch_err;
                    sch_err = RmpSrch1(afUniqueValues, afValueRepeats, gbl_err, step_l, step_r, dwUniqueValues, dwNumPoints);
                    if (sch_err < gbl_err) {
                        gbl_err = sch_err;
                        gbl_l = step_l;
                        gbl_r = step_r;
                    }
                }
            }

            min_r = gbl_l;
            max_r = gbl_r;
        }

        // This is a refinement call. The function tries to make several small stretches or squashes to 
        // minimize quantization error.
        var m_step = LCL_SCH_STEP / IntFctr;
        fMaxError = Refine1(afUniqueValues, afValueRepeats, gbl_err, min_r, max_r, m_step, min_bnd, max_bnd, dwUniqueValues,
            dwNumPoints, _bUseSSE2);

        min_ex = min_r;
        max_ex = max_r;

        max_ex *= (IntFctr - 1);
        min_ex *= (IntFctr - 1);
        /*
        this one is tricky. for the float or high fractional precision ramp it tries to avoid
        for the ramp to be collapsed into one integer number after rounding.
        Notice the condition. There is a difference between max_ex and min_ex but after rounding 
        they may collapse into the same integer.
        
        So we try to run the same refinement procedure but with starting position on the integer grid
        and step equal 1.
        */
        if (!_bFixedRamp && _FracPrc == 0 && max_ex - min_ex > 0. && Math.floor(min_ex + 0.5) == Math.floor(max_ex + 0.5)) {
            m_step = 1.;
            gbl_err = MAX_ERROR;
            for (var i = 0; i < dwUniqueValues; i++)
                afUniqueValues[i] *= (IntFctr - 1);

            max_ex = min_ex = Math.floor(min_ex + 0.5);

            gbl_err = Refine1(afUniqueValues, afValueRepeats, gbl_err, min_ex, max_ex, m_step, 0.0, 255.0, dwUniqueValues, dwNumPoints, _bUseSSE2);

            fMaxError = gbl_err;

        }
        Ramp[1] = Math.floor(max_ex + 0.5);
        Ramp[0] = Math.floor(min_ex + 0.5);
    }

    // Ensure that the two endpoints are not the same
    // This is legal but serves no need & can break some optimizations in the compressor
    if (Ramp[0] == Ramp[1]) {
        if (Ramp[1] < 255.)
            Ramp[1]++;
        else
            Ramp[1]--;
    }
    _RmpPnts[0] = Ramp[0];
    _RmpPnts[1] = Ramp[1];

    return fMaxError;
}

function RmpSrch1(_Blk,
    _Rpt,
    _maxerror,
    _min_ex,
    _max_ex,
    _NmbrClrs,
    nNumPoints) {
    var error = 0;
    const step = (_max_ex - _min_ex) / (nNumPoints - 1);
    const step_h = step * 0.5;
    const rstep = 1.0 / step;

    for (var i = 0; i < _NmbrClrs; i++) {
        var v;
        // Work out which value in the block this select
        var del;

        if ((del = _Blk[i] - _min_ex) <= 0)
            v = _min_ex;
        else if (_Blk[i] - _max_ex >= 0)
            v = _max_ex;
        else
            v = (Math.floor((del + step_h) * rstep) * step) + _min_ex;

        // And accumulate the error
        var del2 = (_Blk[i] - v);
        error += del2 * del2 * _Rpt[i];

        // if we've already lost to the previous step bail out
        if (_maxerror < error) {
            error = _maxerror;
            break;
        }
    }
    return error;
}

function Refine1(_Blk, _Rpt,
    _MaxError, _min_ex, _max_ex, _m_step,
    _min_bnd, _max_bnd, _NmbrClrs,
    dwNumPoints, _bUseSSE2) {
    // Start out assuming our endpoints are the min and max values we've determined

    // Attempt a (simple) progressive refinement step to reduce noise in the
    // output image by trying to find a better overall match for the endpoints.

    var maxerror = _MaxError;
    var min_ex = _min_ex;
    var max_ex = _max_ex;

    var mode, bestmode;
    do {
        var cr_min0 = min_ex;
        var cr_max0 = max_ex;
        for (bestmode = -1, mode = 0; mode < m_nRefinementStepsAlpha * m_nRefinementStepsAlpha; mode++) {
            // check each move (see sStep for direction)
            var cr_min = min_ex + _m_step * sMvF[mode / m_nRefinementStepsAlpha];
            var cr_max = max_ex + _m_step * sMvF[mode % m_nRefinementStepsAlpha];

            cr_min = Math.max(cr_min, _min_bnd);
            cr_max = Math.min(cr_max, _max_bnd);

            var error;
            error = RmpSrch1(_Blk, _Rpt, maxerror, cr_min, cr_max, _NmbrClrs, dwNumPoints);

            if (error < maxerror) {
                maxerror = error;
                bestmode = mode;
                cr_min0 = cr_min;
                cr_max0 = cr_max;
            }
        }

        if (bestmode != -1) {
            // make move (see sStep for direction)
            min_ex = cr_min0;
            max_ex = cr_max0;
        }
    } while (bestmode != -1);

    _min_ex = min_ex;
    _max_ex = max_ex;

    return maxerror;
}

function BldRmp1(_Rmp, _InpRmp, nNumPoints)
{
    // for 3 point ramp; not to select the 4th point in min
    for(var e = nNumPoints; e < MAX_POINTS; e++)
        _Rmp[e] = 100000.0;

    _Rmp[0] = _InpRmp[0];
    _Rmp[1] = _InpRmp[1];
    for(var e = 1; e < nNumPoints - 1; e++)
        _Rmp[e + 1] = (_Rmp[0] * (nNumPoints - 1 - e) + _Rmp[1] * e)/(nNumPoints - 1);
}
/*--------------------------------------------------------------------------------------------

---------------------------------------------------------------------------------------------*/
function GetRmp1(_rampDat, _ramp, nNumPoints, 
                    bFixedRampPoints, _intPrec, _fracPrec, _bFixedRamp)
{
    if(_ramp[0] == _ramp[1])
        return;

    if(!bFixedRampPoints  && _ramp[0] <= _ramp[1] || bFixedRampPoints && _ramp[0] > _ramp[1])
    {
        var t = _ramp[0];
        _ramp[0] = _ramp[1];
        _ramp[1] = t;
    }

    _rampDat[0] = _ramp[0];
    _rampDat[1] = _ramp[1];

    var IntFctr =  (1 << _intPrec);
    var FracFctr =  (1 << _fracPrec);

    var ramp= new Float32Array(NUM_ENDPOINTS);
    ramp[0] = _ramp[0] * FracFctr;
    ramp[1] = _ramp[1] * FracFctr;

    BldRmp1(_rampDat, ramp, nNumPoints);
    if(bFixedRampPoints)
    {
        _rampDat[nNumPoints] = 0.;
        _rampDat[nNumPoints+1] = FracFctr * IntFctr - 1.;
    }

    if(_bFixedRamp)
    {
        for(var i = 0; i < nNumPoints; i++)
        {
            _rampDat[i] = Math.floor(_rampDat[i] + 0.5);
            _rampDat[i] /= FracFctr;
        }
    }
}

function EncodeAlphaBlock(compressedBlock, nEndpoints, nIndices)
{
    compressedBlock[0] = (nEndpoints[0]) | ((nEndpoints[1])<<8);
    compressedBlock[1] = 0;

    for(var i = 0; i < BLOCK_SIZE_4X4; i++)
    {
        if(i < 5)
            compressedBlock[0] |= (nIndices[i] & 0x7) << (16 + (i * 3));
        else if(i > 5)
            compressedBlock[1] |= (nIndices[i] & 0x7) << (2 + (i-6) * 3);
        else
        {
            compressedBlock[0] |= (nIndices[i] & 0x1) << 31;
            compressedBlock[1] |= (nIndices[i] & 0x6) >> 1;
        }
    }
}

export function configureDXTQuality(quality) {
    m_nRefinementSteps = quality;
    m_nRefinementStepsAlpha = quality + 1;
    m_b3DRefinement = quality == 3;
    m_bUseAdaptiveWeighting = quality > 1;
    m_nCompressionSpeed = quality == 0 ? CMP_Speed_Fast : CMP_Speed_Normal;
    m_nCompressionSpeedAlpha = quality == 1 ? CMP_Speed_Fast : CMP_Speed_Normal;
    if (quality == 3)
        m_nRefinementSteps -= 1;
}

export {
    CalculateColourWeightings,
    CompressAlphaBlock,
    CompressRGBBlock,
};

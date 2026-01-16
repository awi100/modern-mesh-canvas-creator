/**
 * Pattern Generator - Production-ready export system
 * Generates deterministic, print-ready pattern bundles
 */

import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { dmcColors, findNearestDMC } from './dmcColors';

// Stable symbol set for chart generation (ordered)
const SYMBOLS = [
  '●', '■', '▲', '◆', '★', '♦', '♣', '♠', '♥',
  '○', '□', '△', '◇', '☆', '◐', '◑', '◒', '◓',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z', '1', '2', '3', '4',
  '5', '6', '7', '8', '9', '0', '@', '#', '$', '%'
];

// Pattern schema version for backwards compatibility
const PATTERN_SCHEMA_VERSION = 1;

/**
 * RGB to Lab color space conversion for perceptually uniform color matching
 */
function rgbToLab(r, g, b) {
  // Normalize RGB to 0-1
  let rn = r / 255;
  let gn = g / 255;
  let bn = b / 255;

  // Apply gamma correction
  rn = rn > 0.04045 ? Math.pow((rn + 0.055) / 1.055, 2.4) : rn / 12.92;
  gn = gn > 0.04045 ? Math.pow((gn + 0.055) / 1.055, 2.4) : gn / 12.92;
  bn = bn > 0.04045 ? Math.pow((bn + 0.055) / 1.055, 2.4) : bn / 12.92;

  // Convert to XYZ (D65 illuminant)
  let x = (rn * 0.4124564 + gn * 0.3575761 + bn * 0.1804375) / 0.95047;
  let y = (rn * 0.2126729 + gn * 0.7151522 + bn * 0.0721750);
  let z = (rn * 0.0193339 + gn * 0.1191920 + bn * 0.9503041) / 1.08883;

  // Convert to Lab
  x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
  y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
  z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;

  return {
    l: (116 * y) - 16,
    a: 500 * (x - y),
    b: 200 * (y - z)
  };
}

/**
 * Calculate Delta E (CIE76) between two Lab colors
 */
function deltaE(lab1, lab2) {
  return Math.sqrt(
    Math.pow(lab1.l - lab2.l, 2) +
    Math.pow(lab1.a - lab2.a, 2) +
    Math.pow(lab1.b - lab2.b, 2)
  );
}

/**
 * Deterministic seeded random number generator
 */
function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * K-means quantization with deterministic seeding
 */
function deterministicKMeans(pixels, k, seed = 42, maxIterations = 20) {
  if (pixels.length === 0) return [];

  const random = seededRandom(seed);

  // Convert all pixels to Lab for better clustering
  const pixelsLab = pixels.map(p => rgbToLab(p[0], p[1], p[2]));

  // K-means++ initialization with deterministic random
  let centroids = [];
  const usedIndices = new Set();

  // First centroid - deterministic selection based on seed
  const firstIdx = Math.floor(random() * pixels.length);
  centroids.push({ ...pixelsLab[firstIdx], rgb: [...pixels[firstIdx]] });
  usedIndices.add(firstIdx);

  // Remaining centroids using k-means++
  for (let i = 1; i < k && i < pixels.length; i++) {
    let maxDist = -1;
    let bestIdx = 0;

    // Sample pixels for efficiency
    const sampleStep = Math.max(1, Math.floor(pixels.length / 2000));
    for (let j = 0; j < pixels.length; j += sampleStep) {
      if (usedIndices.has(j)) continue;

      let minDistToCentroid = Infinity;
      for (const centroid of centroids) {
        const dist = deltaE(pixelsLab[j], centroid);
        minDistToCentroid = Math.min(minDistToCentroid, dist);
      }

      if (minDistToCentroid > maxDist) {
        maxDist = minDistToCentroid;
        bestIdx = j;
      }
    }

    centroids.push({ ...pixelsLab[bestIdx], rgb: [...pixels[bestIdx]] });
    usedIndices.add(bestIdx);
  }

  // K-means iterations
  for (let iter = 0; iter < maxIterations; iter++) {
    const clusters = Array.from({ length: centroids.length }, () => []);

    // Assign pixels to nearest centroid
    const sampleRate = Math.max(1, Math.floor(pixels.length / 50000));
    for (let i = 0; i < pixels.length; i += sampleRate) {
      let minDist = Infinity;
      let clusterIdx = 0;

      for (let j = 0; j < centroids.length; j++) {
        const dist = deltaE(pixelsLab[i], centroids[j]);
        if (dist < minDist) {
          minDist = dist;
          clusterIdx = j;
        }
      }
      clusters[clusterIdx].push({ lab: pixelsLab[i], rgb: pixels[i] });
    }

    // Update centroids
    let converged = true;
    for (let i = 0; i < centroids.length; i++) {
      if (clusters[i].length === 0) continue;

      const newL = clusters[i].reduce((sum, p) => sum + p.lab.l, 0) / clusters[i].length;
      const newA = clusters[i].reduce((sum, p) => sum + p.lab.a, 0) / clusters[i].length;
      const newB = clusters[i].reduce((sum, p) => sum + p.lab.b, 0) / clusters[i].length;

      const newRgbR = Math.round(clusters[i].reduce((sum, p) => sum + p.rgb[0], 0) / clusters[i].length);
      const newRgbG = Math.round(clusters[i].reduce((sum, p) => sum + p.rgb[1], 0) / clusters[i].length);
      const newRgbB = Math.round(clusters[i].reduce((sum, p) => sum + p.rgb[2], 0) / clusters[i].length);

      const dist = Math.sqrt(
        Math.pow(newL - centroids[i].l, 2) +
        Math.pow(newA - centroids[i].a, 2) +
        Math.pow(newB - centroids[i].b, 2)
      );

      if (dist > 1) converged = false;

      centroids[i] = {
        l: newL,
        a: newA,
        b: newB,
        rgb: [newRgbR, newRgbG, newRgbB]
      };
    }

    if (converged) break;
  }

  return centroids.map(c => c.rgb);
}

/**
 * Generate a complete pattern specification from an image
 */
export function generatePatternSpec(imageData, stitchWidth, stitchHeight, meshCount, options = {}) {
  const {
    colorLimit = 30,
    seed = 42,
    gridLineInterval = 10
  } = options;

  // Extract pixels from image data
  const pixels = [];
  for (let i = 0; i < imageData.data.length; i += 4) {
    pixels.push([imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]]);
  }

  // Quantize colors deterministically
  const quantizedCentroids = deterministicKMeans(pixels, colorLimit, seed);

  // Map centroids to DMC colors
  const centroidToDmc = new Map();
  for (const centroid of quantizedCentroids) {
    const dmc = findNearestDMC(centroid, dmcColors);
    centroidToDmc.set(centroid.join(','), dmc);
  }

  // Create unique DMC palette (sorted by ID for determinism)
  const dmcPaletteMap = new Map();
  for (const dmc of centroidToDmc.values()) {
    dmcPaletteMap.set(dmc.id, dmc);
  }
  const selectedCodes = Array.from(dmcPaletteMap.keys()).sort();
  const palette = selectedCodes.map(id => dmcPaletteMap.get(id));

  // Create code to RGB mapping
  const codeToRGB = {};
  const codeToSymbol = {};
  for (let i = 0; i < palette.length; i++) {
    codeToRGB[palette[i].id] = palette[i].rgb;
    codeToSymbol[palette[i].id] = SYMBOLS[i % SYMBOLS.length];
  }

  // Build grid codes and count stitches
  const gridCodes = [];
  const codeCounts = {};
  selectedCodes.forEach(code => codeCounts[code] = 0);

  for (let y = 0; y < stitchHeight; y++) {
    const row = [];
    for (let x = 0; x < stitchWidth; x++) {
      const idx = y * stitchWidth + x;
      const pixel = pixels[idx];

      // Find nearest DMC color from palette
      let minDist = Infinity;
      let nearestCode = selectedCodes[0];

      for (const code of selectedCodes) {
        const rgb = codeToRGB[code];
        const dist =
          Math.pow(pixel[0] - rgb[0], 2) +
          Math.pow(pixel[1] - rgb[1], 2) +
          Math.pow(pixel[2] - rgb[2], 2);

        if (dist < minDist) {
          minDist = dist;
          nearestCode = code;
        }
      }

      row.push(nearestCode);
      codeCounts[nearestCode]++;
    }
    gridCodes.push(row);
  }

  // Calculate physical dimensions
  const physicalWidthIn = stitchWidth / meshCount;
  const physicalHeightIn = stitchHeight / meshCount;

  return {
    patternSchemaVersion: PATTERN_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    meshCount,
    stitchWidth,
    stitchHeight,
    physicalWidthIn: Math.round(physicalWidthIn * 100) / 100,
    physicalHeightIn: Math.round(physicalHeightIn * 100) / 100,
    colorLimit,
    selectedCodes,
    codeToRGB,
    codeToSymbol,
    codeCounts,
    gridCodes,
    gridLineInterval,
    seed
  };
}

/**
 * Render pattern to a canvas with the final DMC colors
 */
export function renderPatternToCanvas(patternSpec, canvas, options = {}) {
  const { showGrid = false, scale = 1 } = options;
  const { stitchWidth, stitchHeight, gridCodes, codeToRGB, gridLineInterval } = patternSpec;

  canvas.width = stitchWidth * scale;
  canvas.height = stitchHeight * scale;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Draw each stitch
  for (let y = 0; y < stitchHeight; y++) {
    for (let x = 0; x < stitchWidth; x++) {
      const code = gridCodes[y][x];
      const rgb = codeToRGB[code];

      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  // Draw grid lines if requested
  if (showGrid && scale >= 2) {
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;

    for (let y = 0; y <= stitchHeight; y++) {
      const isMajor = y % gridLineInterval === 0;
      ctx.strokeStyle = isMajor ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.15)';
      ctx.lineWidth = isMajor ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y * scale);
      ctx.lineTo(stitchWidth * scale, y * scale);
      ctx.stroke();
    }

    for (let x = 0; x <= stitchWidth; x++) {
      const isMajor = x % gridLineInterval === 0;
      ctx.strokeStyle = isMajor ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.15)';
      ctx.lineWidth = isMajor ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x * scale, 0);
      ctx.lineTo(x * scale, stitchHeight * scale);
      ctx.stroke();
    }
  }

  return canvas;
}

/**
 * Generate production PDF with correct physical sizing
 */
export function generateProductionPDF(patternSpec, options = {}) {
  const {
    showGrid = true,
    gridLineInterval = 10,
    includeLegend = true
  } = options;

  const {
    stitchWidth,
    stitchHeight,
    meshCount,
    physicalWidthIn,
    physicalHeightIn,
    gridCodes,
    codeToRGB,
    selectedCodes,
    codeCounts
  } = patternSpec;

  // Calculate cell size in points (72 points = 1 inch)
  const cellSizePt = 72 / meshCount;

  // Page dimensions with margins
  const marginPt = 36; // 0.5 inch margins
  const legendHeightPt = includeLegend ? 100 : 0;

  const pageWidthPt = physicalWidthIn * 72 + marginPt * 2;
  const pageHeightPt = physicalHeightIn * 72 + marginPt * 2 + legendHeightPt;

  // Create PDF with custom page size
  const pdf = new jsPDF({
    orientation: pageWidthPt > pageHeightPt ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [pageWidthPt, pageHeightPt]
  });

  // Draw legend at top if included
  let offsetY = marginPt;
  if (includeLegend) {
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Modern Mesh Co. - Production Pattern', marginPt, offsetY + 14);

    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Size: ${physicalWidthIn}" × ${physicalHeightIn}" | Mesh: ${meshCount} | Stitches: ${stitchWidth} × ${stitchHeight}`, marginPt, offsetY + 30);

    // Color legend
    let legendX = marginPt;
    let legendY = offsetY + 50;
    const swatchSize = 12;
    const colWidth = 80;

    pdf.setFontSize(8);
    for (let i = 0; i < selectedCodes.length; i++) {
      const code = selectedCodes[i];
      const rgb = codeToRGB[code];
      const count = codeCounts[code];

      // Color swatch
      pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
      pdf.rect(legendX, legendY, swatchSize, swatchSize, 'F');
      pdf.setDrawColor(0);
      pdf.rect(legendX, legendY, swatchSize, swatchSize, 'S');

      // Code and count
      pdf.setTextColor(0);
      pdf.text(`${code} (${count})`, legendX + swatchSize + 4, legendY + 9);

      legendX += colWidth;
      if (legendX + colWidth > pageWidthPt - marginPt) {
        legendX = marginPt;
        legendY += swatchSize + 4;
      }
    }

    offsetY += legendHeightPt;
  }

  // Draw pattern grid
  for (let y = 0; y < stitchHeight; y++) {
    for (let x = 0; x < stitchWidth; x++) {
      const code = gridCodes[y][x];
      const rgb = codeToRGB[code];

      const cellX = marginPt + x * cellSizePt;
      const cellY = offsetY + y * cellSizePt;

      pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
      pdf.rect(cellX, cellY, cellSizePt, cellSizePt, 'F');
    }
  }

  // Draw grid lines if requested
  if (showGrid) {
    pdf.setDrawColor(180);
    pdf.setLineWidth(0.25);

    // Light grid - every stitch
    for (let y = 0; y <= stitchHeight; y++) {
      pdf.line(
        marginPt,
        offsetY + y * cellSizePt,
        marginPt + stitchWidth * cellSizePt,
        offsetY + y * cellSizePt
      );
    }
    for (let x = 0; x <= stitchWidth; x++) {
      pdf.line(
        marginPt + x * cellSizePt,
        offsetY,
        marginPt + x * cellSizePt,
        offsetY + stitchHeight * cellSizePt
      );
    }

    // Major grid - every N stitches
    pdf.setDrawColor(100);
    pdf.setLineWidth(0.75);
    for (let y = 0; y <= stitchHeight; y += gridLineInterval) {
      pdf.line(
        marginPt,
        offsetY + y * cellSizePt,
        marginPt + stitchWidth * cellSizePt,
        offsetY + y * cellSizePt
      );
    }
    for (let x = 0; x <= stitchWidth; x += gridLineInterval) {
      pdf.line(
        marginPt + x * cellSizePt,
        offsetY,
        marginPt + x * cellSizePt,
        offsetY + stitchHeight * cellSizePt
      );
    }
  }

  return pdf;
}

/**
 * Generate a chart PDF with symbols for stitching guide
 */
export function generateChartPDF(patternSpec) {
  const {
    stitchWidth,
    stitchHeight,
    gridCodes,
    codeToRGB,
    codeToSymbol,
    selectedCodes,
    codeCounts,
    meshCount,
    physicalWidthIn,
    physicalHeightIn
  } = patternSpec;

  // Fixed cell size for readability
  const cellSizePt = 12;
  const marginPt = 36;
  const legendHeightPt = 120;

  const pageWidthPt = stitchWidth * cellSizePt + marginPt * 2;
  const pageHeightPt = stitchHeight * cellSizePt + marginPt * 2 + legendHeightPt;

  const pdf = new jsPDF({
    orientation: pageWidthPt > pageHeightPt ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [Math.max(pageWidthPt, 612), Math.max(pageHeightPt, 792)] // Min letter size
  });

  // Header
  let offsetY = marginPt;
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Modern Mesh Co. - Stitch Chart', marginPt, offsetY + 16);

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Size: ${physicalWidthIn}" × ${physicalHeightIn}" | Mesh: ${meshCount} | Stitches: ${stitchWidth} × ${stitchHeight}`, marginPt, offsetY + 32);

  // Symbol legend
  let legendX = marginPt;
  let legendY = offsetY + 55;
  const swatchSize = 14;
  const colWidth = 100;

  pdf.setFontSize(9);
  for (let i = 0; i < selectedCodes.length; i++) {
    const code = selectedCodes[i];
    const rgb = codeToRGB[code];
    const symbol = codeToSymbol[code];
    const count = codeCounts[code];

    // Color swatch
    pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
    pdf.rect(legendX, legendY, swatchSize, swatchSize, 'F');
    pdf.setDrawColor(0);
    pdf.rect(legendX, legendY, swatchSize, swatchSize, 'S');

    // Symbol
    pdf.setTextColor(0);
    pdf.text(symbol, legendX + swatchSize + 4, legendY + 11);

    // Code and count
    pdf.text(`${code} (${count})`, legendX + swatchSize + 16, legendY + 11);

    legendX += colWidth;
    if (legendX + colWidth > pdf.internal.pageSize.getWidth() - marginPt) {
      legendX = marginPt;
      legendY += swatchSize + 6;
    }
  }

  offsetY += legendHeightPt;

  // Draw chart grid with symbols
  pdf.setFontSize(7);
  for (let y = 0; y < stitchHeight; y++) {
    for (let x = 0; x < stitchWidth; x++) {
      const code = gridCodes[y][x];
      const rgb = codeToRGB[code];
      const symbol = codeToSymbol[code];

      const cellX = marginPt + x * cellSizePt;
      const cellY = offsetY + y * cellSizePt;

      // Light background color
      const lightR = Math.min(255, rgb[0] + (255 - rgb[0]) * 0.7);
      const lightG = Math.min(255, rgb[1] + (255 - rgb[1]) * 0.7);
      const lightB = Math.min(255, rgb[2] + (255 - rgb[2]) * 0.7);

      pdf.setFillColor(lightR, lightG, lightB);
      pdf.rect(cellX, cellY, cellSizePt, cellSizePt, 'F');

      // Symbol
      pdf.setTextColor(0);
      pdf.text(symbol, cellX + cellSizePt / 2 - 2, cellY + cellSizePt / 2 + 2);
    }
  }

  // Grid lines
  pdf.setDrawColor(150);
  pdf.setLineWidth(0.25);
  for (let y = 0; y <= stitchHeight; y++) {
    pdf.line(marginPt, offsetY + y * cellSizePt, marginPt + stitchWidth * cellSizePt, offsetY + y * cellSizePt);
  }
  for (let x = 0; x <= stitchWidth; x++) {
    pdf.line(marginPt + x * cellSizePt, offsetY, marginPt + x * cellSizePt, offsetY + stitchHeight * cellSizePt);
  }

  // Major grid lines every 10
  pdf.setDrawColor(50);
  pdf.setLineWidth(1);
  for (let y = 0; y <= stitchHeight; y += 10) {
    pdf.line(marginPt, offsetY + y * cellSizePt, marginPt + stitchWidth * cellSizePt, offsetY + y * cellSizePt);
  }
  for (let x = 0; x <= stitchWidth; x += 10) {
    pdf.line(marginPt + x * cellSizePt, offsetY, marginPt + x * cellSizePt, offsetY + stitchHeight * cellSizePt);
  }

  return pdf;
}

/**
 * Generate complete production bundle as ZIP
 */
export async function generateProductionBundle(patternSpec, originalImageDataUrl, previewCanvas) {
  const zip = new JSZip();

  // 1. Pattern JSON metadata
  const patternJson = JSON.stringify(patternSpec, null, 2);
  zip.file('pattern.json', patternJson);

  // 2. Original image
  const originalBlob = await fetch(originalImageDataUrl).then(r => r.blob());
  zip.file('original.png', originalBlob);

  // 3. Preview PNG
  const previewBlob = await new Promise(resolve => {
    previewCanvas.toBlob(resolve, 'image/png');
  });
  zip.file('preview.png', previewBlob);

  // 4. Production PDF
  const productionPdf = generateProductionPDF(patternSpec, { showGrid: true, includeLegend: true });
  const productionPdfBlob = productionPdf.output('blob');
  zip.file('production.pdf', productionPdfBlob);

  // 5. Chart PDF (with symbols)
  const chartPdf = generateChartPDF(patternSpec);
  const chartPdfBlob = chartPdf.output('blob');
  zip.file('chart.pdf', chartPdfBlob);

  // 6. High-res print image (PNG at 300 DPI)
  const printCanvas = document.createElement('canvas');
  const dpi = 300;
  const printScale = Math.round(dpi / patternSpec.meshCount);
  renderPatternToCanvas(patternSpec, printCanvas, { scale: printScale, showGrid: false });
  const printBlob = await new Promise(resolve => {
    printCanvas.toBlob(resolve, 'image/png');
  });
  zip.file('print-300dpi.png', printBlob);

  // Generate ZIP blob
  const zipBlob = await zip.generateAsync({ type: 'blob' });

  return {
    zipBlob,
    productionPdfBlob,
    patternJson,
    patternSpec
  };
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

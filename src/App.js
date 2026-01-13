import React, { useState, useRef, useEffect, useCallback } from 'react';
import { dmcColors, findNearestDMC } from './dmcColors';
import './App.css';

// Configuration - UPDATE THESE WITH YOUR VALUES
const CONFIG = {
  // Your Shopify store URL (without trailing slash)
  shopifyStoreUrl: 'https://modernmeshco.com/',
  
  // Your Shopify product variant IDs for each size
  // Find these in Shopify Admin > Products > Your Product > Variants
  variantIds: {
    '5x5': '42811374272617', // Replace with actual variant ID
    '8x10': '42811374305385',
    '12x12': '42811374338153',
    '14x18': '42811374370921',
  },
  
  // Cloudinary settings (UPDATE THESE)
  cloudinary: {
    cloudName: 'dw0uvrvzl', // Replace with your Cloudinary cloud name
    uploadPreset: 'modern_mesh_uploads', // Replace with your upload preset
  },
};

// Canvas size options with pricing
const CANVAS_SIZES = {
  '5x5': { width: 5, height: 5, name: 'Mini', dimensions: '5" × 5"', price: 39, meshCount: 13 },
  '8x10': { width: 8, height: 10, name: 'Standard', dimensions: '8" × 10"', price: 65, meshCount: 13 },
  '12x12': { width: 12, height: 12, name: 'Large', dimensions: '12" × 12"', price: 95, meshCount: 13 },
  '14x18': { width: 14, height: 18, name: 'Premium', dimensions: '14" × 18"', price: 145, meshCount: 13 },
};

function App() {
  const [step, setStep] = useState(1);
  const [image, setImage] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [settings, setSettings] = useState({
    canvasSize: '8x10',
    colorCount: 16,
    showGrid: true,
  });
  const [processing, setProcessing] = useState(false);
  const [selectedColors, setSelectedColors] = useState([]);
  const [uploadingToCloud, setUploadingToCloud] = useState(false);
  
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const printCanvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // Handle image upload
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        alert('Image too large. Please use an image under 20MB.');
        return;
      }
      
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target.result);
        setPreview(null);
        setSelectedColors([]);
        setStep(2);
      };
      reader.readAsDataURL(file);
    }
  };

  // K-means color quantization
  const kMeansQuantize = useCallback((pixels, k, maxIterations = 15) => {
    if (pixels.length === 0) return [];
    
    // Initialize centroids using k-means++ for better starting points
    let centroids = [];
    const usedIndices = new Set();
    
    // First centroid is random
    let firstIdx = Math.floor(Math.random() * pixels.length);
    centroids.push([...pixels[firstIdx]]);
    usedIndices.add(firstIdx);
    
    // Remaining centroids chosen with probability proportional to distance
    for (let i = 1; i < k; i++) {
      let maxDist = -1;
      let bestIdx = 0;
      
      for (let j = 0; j < pixels.length; j += Math.max(1, Math.floor(pixels.length / 1000))) {
        if (usedIndices.has(j)) continue;
        
        let minDistToCentroid = Infinity;
        for (const centroid of centroids) {
          const dist = Math.sqrt(
            Math.pow(pixels[j][0] - centroid[0], 2) +
            Math.pow(pixels[j][1] - centroid[1], 2) +
            Math.pow(pixels[j][2] - centroid[2], 2)
          );
          minDistToCentroid = Math.min(minDistToCentroid, dist);
        }
        
        if (minDistToCentroid > maxDist) {
          maxDist = minDistToCentroid;
          bestIdx = j;
        }
      }
      
      centroids.push([...pixels[bestIdx]]);
      usedIndices.add(bestIdx);
    }

    // K-means iterations
    for (let iter = 0; iter < maxIterations; iter++) {
      const clusters = Array.from({ length: k }, () => []);
      
      // Assign pixels to nearest centroid (sample for speed)
      const sampleRate = Math.max(1, Math.floor(pixels.length / 50000));
      for (let i = 0; i < pixels.length; i += sampleRate) {
        let minDist = Infinity;
        let clusterIdx = 0;
        
        for (let j = 0; j < k; j++) {
          const dist = 
            Math.pow(pixels[i][0] - centroids[j][0], 2) +
            Math.pow(pixels[i][1] - centroids[j][1], 2) +
            Math.pow(pixels[i][2] - centroids[j][2], 2);
          
          if (dist < minDist) {
            minDist = dist;
            clusterIdx = j;
          }
        }
        clusters[clusterIdx].push(pixels[i]);
      }

      // Update centroids
      let converged = true;
      for (let i = 0; i < k; i++) {
        if (clusters[i].length === 0) continue;
        
        const newCentroid = [0, 0, 0];
        for (const pixel of clusters[i]) {
          newCentroid[0] += pixel[0];
          newCentroid[1] += pixel[1];
          newCentroid[2] += pixel[2];
        }
        newCentroid[0] = Math.round(newCentroid[0] / clusters[i].length);
        newCentroid[1] = Math.round(newCentroid[1] / clusters[i].length);
        newCentroid[2] = Math.round(newCentroid[2] / clusters[i].length);
        
        const dist = Math.sqrt(
          Math.pow(newCentroid[0] - centroids[i][0], 2) +
          Math.pow(newCentroid[1] - centroids[i][1], 2) +
          Math.pow(newCentroid[2] - centroids[i][2], 2)
        );
        
        if (dist > 2) converged = false;
        centroids[i] = newCentroid;
      }
      
      if (converged) break;
    }

    return centroids;
  }, []);

  // Generate preview
  const generatePreview = useCallback(() => {
    if (!image || !canvasRef.current) return;

    setProcessing(true);

    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      const size = CANVAS_SIZES[settings.canvasSize];
      const stitchesX = size.width * size.meshCount;
      const stitchesY = size.height * size.meshCount;
      
      canvas.width = stitchesX;
      canvas.height = stitchesY;
      
      // Calculate crop to maintain aspect ratio
      const imgAspect = img.width / img.height;
      const canvasAspect = stitchesX / stitchesY;
      
      let srcX = 0, srcY = 0, srcW = img.width, srcH = img.height;
      
      if (imgAspect > canvasAspect) {
        srcW = img.height * canvasAspect;
        srcX = (img.width - srcW) / 2;
      } else {
        srcH = img.width / canvasAspect;
        srcY = (img.height - srcH) / 2;
      }
      
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, stitchesX, stitchesY);
      
      const imageData = ctx.getImageData(0, 0, stitchesX, stitchesY);
      const pixels = [];
      
      for (let i = 0; i < imageData.data.length; i += 4) {
        pixels.push([imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]]);
      }

      // Quantize colors
      const quantizedCentroids = kMeansQuantize(pixels, settings.colorCount);
      
      // Match to DMC colors
      const dmcPalette = quantizedCentroids.map(centroid => findNearestDMC(centroid, dmcColors));
      const uniquePalette = [...new Map(dmcPalette.map(c => [c.id, c])).values()];
      setSelectedColors(uniquePalette);

      // Apply quantized colors to image data
      for (let i = 0; i < pixels.length; i++) {
        let minDist = Infinity;
        let nearestIdx = 0;
        
        for (let j = 0; j < quantizedCentroids.length; j++) {
          const dist = 
            Math.pow(pixels[i][0] - quantizedCentroids[j][0], 2) +
            Math.pow(pixels[i][1] - quantizedCentroids[j][1], 2) +
            Math.pow(pixels[i][2] - quantizedCentroids[j][2], 2);
          
          if (dist < minDist) {
            minDist = dist;
            nearestIdx = j;
          }
        }
        
        const dmcColor = dmcPalette[nearestIdx];
        imageData.data[i * 4] = dmcColor.rgb[0];
        imageData.data[i * 4 + 1] = dmcColor.rgb[1];
        imageData.data[i * 4 + 2] = dmcColor.rgb[2];
      }
      
      ctx.putImageData(imageData, 0, 0);

      // Draw preview with stitch effect
      const previewCanvas = previewCanvasRef.current;
      const previewCtx = previewCanvas.getContext('2d');
      const displayScale = Math.min(4, Math.floor(600 / Math.max(stitchesX, stitchesY)));
      
      previewCanvas.width = stitchesX * displayScale;
      previewCanvas.height = stitchesY * displayScale;
      
      // Background (canvas color)
      previewCtx.fillStyle = '#F5F5DC';
      previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
      
      // Draw each stitch
      for (let y = 0; y < stitchesY; y++) {
        for (let x = 0; x < stitchesX; x++) {
          const idx = (y * stitchesX + x) * 4;
          const r = imageData.data[idx];
          const g = imageData.data[idx + 1];
          const b = imageData.data[idx + 2];
          
          // Stitch base color
          previewCtx.fillStyle = `rgb(${r},${g},${b})`;
          previewCtx.fillRect(
            x * displayScale + 0.5,
            y * displayScale + 0.5,
            displayScale - 1,
            displayScale - 1
          );

          // Draw X stitch pattern
          if (displayScale >= 3) {
            previewCtx.save();
            previewCtx.translate(
              x * displayScale + displayScale / 2,
              y * displayScale + displayScale / 2
            );
            
            const lighter = `rgb(${Math.min(255, r + 25)},${Math.min(255, g + 25)},${Math.min(255, b + 25)})`;
            const darker = `rgb(${Math.max(0, r - 25)},${Math.max(0, g - 25)},${Math.max(0, b - 25)})`;
            
            previewCtx.strokeStyle = lighter;
            previewCtx.lineWidth = Math.max(1, displayScale * 0.2);
            previewCtx.lineCap = 'round';
            
            // First diagonal
            previewCtx.beginPath();
            previewCtx.moveTo(-displayScale * 0.35, -displayScale * 0.35);
            previewCtx.lineTo(displayScale * 0.35, displayScale * 0.35);
            previewCtx.stroke();
            
            previewCtx.strokeStyle = darker;
            // Second diagonal
            previewCtx.beginPath();
            previewCtx.moveTo(displayScale * 0.35, -displayScale * 0.35);
            previewCtx.lineTo(-displayScale * 0.35, displayScale * 0.35);
            previewCtx.stroke();
            
            previewCtx.restore();
          }

          // Grid lines
          if (settings.showGrid) {
            previewCtx.strokeStyle = 'rgba(0,0,0,0.1)';
            previewCtx.lineWidth = 0.5;
            previewCtx.strokeRect(
              x * displayScale,
              y * displayScale,
              displayScale,
              displayScale
            );
          }
        }
      }

      setPreview(previewCanvas.toDataURL('image/png'));
      setProcessing(false);
    };
    
    img.src = image;
  }, [image, settings, kMeansQuantize]);

  // Generate preview when settings change
  useEffect(() => {
    if (image && step >= 2) {
      const timer = setTimeout(() => {
        generatePreview();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [image, settings, generatePreview, step]);

  // Generate print-ready file
  const generatePrintFile = useCallback(() => {
    if (!canvasRef.current) return null;
    
    const canvas = canvasRef.current;
    const size = CANVAS_SIZES[settings.canvasSize];
    
    // Create high-resolution print canvas (300 DPI)
    const printCanvas = printCanvasRef.current || document.createElement('canvas');
    const dpi = 300;
    const printWidth = size.width * dpi;
    const printHeight = size.height * dpi;
    
    printCanvas.width = printWidth;
    printCanvas.height = printHeight;
    
    const printCtx = printCanvas.getContext('2d');
    
    // Draw the quantized image at high resolution
    printCtx.imageSmoothingEnabled = false;
    printCtx.drawImage(canvas, 0, 0, printWidth, printHeight);
    
    return printCanvas.toDataURL('image/png');
  }, [settings.canvasSize]);

  // Upload to Cloudinary
  const uploadToCloudinary = async (dataUrl, filename) => {
    const formData = new FormData();
    
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    formData.append('file', blob, filename);
    formData.append('upload_preset', CONFIG.cloudinary.uploadPreset);
    formData.append('folder', 'modern-mesh-orders');
    
    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${CONFIG.cloudinary.cloudName}/image/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );
    
    const data = await uploadResponse.json();
    return data.secure_url;
  };

  // Handle checkout
  const handleCheckout = async () => {
    setUploadingToCloud(true);
    
    try {
      // Generate print file
      const printFile = generatePrintFile();
      
      // Upload original image and print file to Cloudinary
      const [originalUrl, printUrl, previewUrl] = await Promise.all([
        uploadToCloudinary(image, 'original.png'),
        uploadToCloudinary(printFile, 'print-ready.png'),
        uploadToCloudinary(preview, 'preview.png'),
      ]);
      
      // Create order data
      const orderData = {
        originalImage: originalUrl,
        printFile: printUrl,
        previewImage: previewUrl,
        settings: {
          size: settings.canvasSize,
          sizeName: CANVAS_SIZES[settings.canvasSize].name,
          dimensions: CANVAS_SIZES[settings.canvasSize].dimensions,
          colorCount: selectedColors.length,
        },
        colors: selectedColors.map(c => ({ id: c.id, name: c.name, hex: c.hex })),
        timestamp: new Date().toISOString(),
      };
      
      // Encode order data for URL
      const encodedData = encodeURIComponent(JSON.stringify(orderData));
      
      // Redirect to Shopify cart
      const variantId = CONFIG.variantIds[settings.canvasSize];
      const cartUrl = `${CONFIG.shopifyStoreUrl}/cart/add?id=${variantId}&quantity=1&properties[_order_data]=${encodedData}&properties[Preview]=${encodeURIComponent(previewUrl)}&properties[Colors]=${selectedColors.length}%20DMC%20threads`;
      
      window.location.href = cartUrl;
      
    } catch (error) {
      console.error('Upload error:', error);
      alert('There was an error processing your order. Please try again.');
      setUploadingToCloud(false);
    }
  };

  // Download preview
  const downloadPreview = () => {
    const link = document.createElement('a');
    link.download = 'modern-mesh-preview.png';
    link.href = preview;
    link.click();
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <a href={CONFIG.shopifyStoreUrl} className="logo">
            Modern Mesh Co.
          </a>
          <nav className="nav">
            <a href={CONFIG.shopifyStoreUrl}>← Back to Store</a>
          </nav>
        </div>
      </header>

      {/* Progress Steps */}
      <div className="progress-bar">
        <div className="progress-steps">
          <div className={`progress-step ${step >= 1 ? 'active' : ''}`}>
            <span className="step-number">1</span>
            <span className="step-label">Upload</span>
          </div>
          <div className={`progress-step ${step >= 2 ? 'active' : ''}`}>
            <span className="step-number">2</span>
            <span className="step-label">Customize</span>
          </div>
          <div className={`progress-step ${step >= 3 ? 'active' : ''}`}>
            <span className="step-number">3</span>
            <span className="step-label">Review</span>
          </div>
        </div>
      </div>

      <main className="main">
        {/* Step 1: Upload */}
        {step === 1 && (
          <div className="upload-section">
            <div className="upload-content">
              <h1>Create Your Custom Needlepoint Canvas</h1>
              <p className="subtitle">
                Upload any photo and we'll transform it into a beautiful needlepoint kit 
                with color-matched DMC threads.
              </p>
              
              <label className="upload-area" onClick={() => fileInputRef.current?.click()}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
                <div className="upload-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="upload-text">Click to upload your photo</span>
                <span className="upload-hint">JPEG, PNG, or HEIC up to 20MB</span>
              </label>

              <div className="features">
                <div className="feature">
                  <span className="feature-icon">🎨</span>
                  <span>DMC color matching</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">📐</span>
                  <span>Multiple sizes available</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">✂️</span>
                  <span>Pre-cut threads included</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2 & 3: Customize and Review */}
        {step >= 2 && (
          <div className="creator-section">
            <div className="creator-grid">
              {/* Left Panel - Controls */}
              <div className="controls-panel">
                <h2>Customize Your Canvas</h2>
                
                {/* Original Image Preview */}
                <div className="original-preview">
                  <h3>Your Photo</h3>
                  <div className="original-image-container">
                    <img src={image} alt="Original" className="original-image" />
                    <button 
                      className="change-photo-btn"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Change Photo
                    </button>
                  </div>
                </div>

                {/* Size Selection */}
                <div className="control-group">
                  <h3>Canvas Size</h3>
                  <div className="size-options">
                    {Object.entries(CANVAS_SIZES).map(([key, value]) => (
                      <button
                        key={key}
                        className={`size-option ${settings.canvasSize === key ? 'selected' : ''}`}
                        onClick={() => setSettings(s => ({ ...s, canvasSize: key }))}
                      >
                        <span className="size-name">{value.name}</span>
                        <span className="size-dimensions">{value.dimensions}</span>
                        <span className="size-price">${value.price}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color Count */}
                <div className="control-group">
                  <h3>Thread Colors: {settings.colorCount}</h3>
                  <input
                    type="range"
                    min="8"
                    max="32"
                    value={settings.colorCount}
                    onChange={(e) => setSettings(s => ({ ...s, colorCount: parseInt(e.target.value) }))}
                    className="color-slider"
                  />
                  <div className="slider-labels">
                    <span>Simpler</span>
                    <span>More Detail</span>
                  </div>
                </div>

                {/* Grid Toggle */}
                <div className="control-group toggle-group">
                  <span>Show Stitch Grid</span>
                  <button
                    className={`toggle ${settings.showGrid ? 'on' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, showGrid: !s.showGrid }))}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>

                {/* Thread Colors */}
                {selectedColors.length > 0 && (
                  <div className="control-group">
                    <h3>DMC Thread Colors ({selectedColors.length})</h3>
                    <div className="color-swatches">
                      {selectedColors.map((color, idx) => (
                        <div key={idx} className="color-swatch" title={`DMC ${color.id} - ${color.name}`}>
                          <span 
                            className="swatch-color" 
                            style={{ backgroundColor: color.hex }}
                          />
                          <span className="swatch-id">{color.id}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Panel - Preview */}
              <div className="preview-panel">
                <h2>Canvas Preview</h2>
                
                <div className="preview-container">
                  {processing && (
                    <div className="processing-overlay">
                      <div className="spinner" />
                      <span>Generating preview...</span>
                    </div>
                  )}
                  
                  {preview ? (
                    <img src={preview} alt="Needlepoint preview" className="preview-image" />
                  ) : (
                    <div className="preview-placeholder">
                      <span>Generating preview...</span>
                    </div>
                  )}
                </div>

                {/* Hidden canvases for processing */}
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <canvas ref={previewCanvasRef} style={{ display: 'none' }} />
                <canvas ref={printCanvasRef} style={{ display: 'none' }} />

                {/* Order Summary */}
                {preview && (
                  <div className="order-summary">
                    <div className="summary-row">
                      <span>{CANVAS_SIZES[settings.canvasSize].name} Canvas</span>
                      <span>{CANVAS_SIZES[settings.canvasSize].dimensions}</span>
                    </div>
                    <div className="summary-row">
                      <span>DMC Threads</span>
                      <span>{selectedColors.length} colors included</span>
                    </div>
                    <div className="summary-row">
                      <span>Tapestry Needles</span>
                      <span>2 included</span>
                    </div>
                    <div className="summary-row">
                      <span>Stitch Guide</span>
                      <span>Full color, included</span>
                    </div>
                    <div className="summary-total">
                      <span>Total</span>
                      <span className="price">${CANVAS_SIZES[settings.canvasSize].price}</span>
                    </div>
                    
                    <button 
                      className="checkout-btn"
                      onClick={handleCheckout}
                      disabled={uploadingToCloud}
                    >
                      {uploadingToCloud ? (
                        <>
                          <span className="btn-spinner" />
                          Processing...
                        </>
                      ) : (
                        'Add to Cart →'
                      )}
                    </button>
                    
                    <button className="download-btn" onClick={downloadPreview}>
                      Download Preview
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>© 2026 Modern Mesh Co. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default App;

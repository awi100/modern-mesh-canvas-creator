import { useState, useRef, useEffect, useCallback } from 'react';
import { dmcColors } from './dmcColors';
import {
  generatePatternSpec,
  generateProductionBundle,
  downloadBlob
} from './patternGenerator';
import './App.css';

// Configuration - UPDATE THESE WITH YOUR VALUES
const CONFIG = {
  // Your Shopify store URL (without trailing slash)
  shopifyStoreUrl: 'https://modernmeshco.com/',

  // Your Shopify product variant IDs for each mesh type
  // Find these in Shopify Admin > Products > Your Product > Variants
  variantIds: {
    '14mesh': '42811374272617', // Replace with actual variant ID for 14 mesh
    '18mesh': '42811374305385', // Replace with actual variant ID for 18 mesh
  },

  // Cloudinary settings (UPDATE THESE)
  cloudinary: {
    cloudName: 'dw0uvrvzl', // Replace with your Cloudinary cloud name
    uploadPreset: 'modern_mesh_uploads', // Replace with your upload preset
  },
};

// Canvas size options with pricing (14 mesh and 18 mesh only)
const CANVAS_SIZES = {
  '14mesh': { width: 10, height: 10, name: '14 Mesh', dimensions: '10" × 10"', price: 75, meshCount: 14 },
  '18mesh': { width: 10, height: 10, name: '18 Mesh', dimensions: '10" × 10"', price: 95, meshCount: 18 },
};

function App() {
  const [step, setStep] = useState(1);
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [settings, setSettings] = useState({
    canvasSize: '14mesh',
  });
  const [processing, setProcessing] = useState(false);
  const [selectedColors, setSelectedColors] = useState([]);
  const [uploadingToCloud, setUploadingToCloud] = useState(false);
  const [patternSpec, setPatternSpec] = useState(null);

  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // Handle image upload
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        alert('Image too large. Please use an image under 20MB.');
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target.result);
        setPreview(null);
        setSelectedColors([]);
        setPatternSpec(null);
        setStep(2);
      };
      reader.readAsDataURL(file);
    }
  };

  // Generate preview using deterministic pattern generator
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

      // Calculate crop to maintain aspect ratio (cover mode)
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

      // Draw image at stitch resolution
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, stitchesX, stitchesY);

      // Get image data for pattern generation
      const imageData = ctx.getImageData(0, 0, stitchesX, stitchesY);

      // Generate deterministic pattern spec
      const spec = generatePatternSpec(imageData, stitchesX, stitchesY, size.meshCount, {
        colorLimit: 30,
        seed: 42, // Deterministic seed
        gridLineInterval: 10
      });

      setPatternSpec(spec);

      // Build palette for display
      const palette = spec.selectedCodes.map(code => {
        const dmc = dmcColors.find(c => c.id === code);
        return dmc || { id: code, name: code, rgb: spec.codeToRGB[code], hex: `#${spec.codeToRGB[code].map(v => v.toString(16).padStart(2, '0')).join('')}` };
      });
      setSelectedColors(palette);

      // Render preview with stitch effect
      const previewCanvas = previewCanvasRef.current;
      const previewCtx = previewCanvas.getContext('2d');
      const displayScale = Math.min(4, Math.floor(600 / Math.max(stitchesX, stitchesY)));

      previewCanvas.width = stitchesX * displayScale;
      previewCanvas.height = stitchesY * displayScale;

      // Background (canvas color)
      previewCtx.fillStyle = '#F5F5DC';
      previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

      // Draw each stitch using pattern spec
      for (let y = 0; y < stitchesY; y++) {
        for (let x = 0; x < stitchesX; x++) {
          const code = spec.gridCodes[y][x];
          const rgb = spec.codeToRGB[code];
          const [r, g, b] = rgb;

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

      setPreview(previewCanvas.toDataURL('image/png'));
      setProcessing(false);
    };

    img.src = image;
  }, [image, settings]);

  // Generate preview when settings change
  useEffect(() => {
    if (image && step >= 2) {
      const timer = setTimeout(() => {
        generatePreview();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [image, settings, generatePreview, step]);

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

  // Upload blob to Cloudinary
  const uploadBlobToCloudinary = async (blob, filename) => {
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('upload_preset', CONFIG.cloudinary.uploadPreset);
    formData.append('folder', 'modern-mesh-orders');

    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${CONFIG.cloudinary.cloudName}/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );

    const data = await uploadResponse.json();
    return data.secure_url;
  };

  // Handle checkout - generates production bundle and uploads
  const handleCheckout = async () => {
    if (!patternSpec) return;

    setUploadingToCloud(true);

    try {
      // Generate production bundle
      const bundle = await generateProductionBundle(
        patternSpec,
        image,
        previewCanvasRef.current
      );

      // Upload files to Cloudinary
      const [originalUrl, previewUrl, bundleUrl] = await Promise.all([
        uploadToCloudinary(image, 'original.png'),
        uploadToCloudinary(preview, 'preview.png'),
        uploadBlobToCloudinary(bundle.zipBlob, `production-bundle-${Date.now()}.zip`),
      ]);

      // Create order data with full pattern spec
      const orderData = {
        originalImage: originalUrl,
        previewImage: previewUrl,
        productionBundle: bundleUrl,
        patternSpec: {
          meshCount: patternSpec.meshCount,
          stitchWidth: patternSpec.stitchWidth,
          stitchHeight: patternSpec.stitchHeight,
          physicalWidthIn: patternSpec.physicalWidthIn,
          physicalHeightIn: patternSpec.physicalHeightIn,
          colorCount: patternSpec.selectedCodes.length,
          selectedCodes: patternSpec.selectedCodes,
          codeCounts: patternSpec.codeCounts,
        },
        settings: {
          size: settings.canvasSize,
          sizeName: CANVAS_SIZES[settings.canvasSize].name,
          dimensions: CANVAS_SIZES[settings.canvasSize].dimensions,
        },
        colors: selectedColors.map(c => ({ id: c.id, name: c.name, hex: c.hex })),
        timestamp: new Date().toISOString(),
      };

      // Encode order data for URL
      const encodedData = encodeURIComponent(JSON.stringify(orderData));

      // Redirect to Shopify cart
      const variantId = CONFIG.variantIds[settings.canvasSize];
      const cartUrl = `${CONFIG.shopifyStoreUrl}/cart/add?id=${variantId}&quantity=1&properties[_order_data]=${encodedData}&properties[Preview]=${encodeURIComponent(previewUrl)}&properties[Colors]=${selectedColors.length}%20DMC%20threads&properties[Bundle]=${encodeURIComponent(bundleUrl)}`;

      window.location.href = cartUrl;

    } catch (error) {
      console.error('Upload error:', error);
      alert('There was an error processing your order. Please try again.');
      setUploadingToCloud(false);
    }
  };

  // Download production bundle
  const downloadBundle = async () => {
    if (!patternSpec) return;

    setProcessing(true);
    try {
      const bundle = await generateProductionBundle(
        patternSpec,
        image,
        previewCanvasRef.current
      );

      const timestamp = new Date().toISOString().slice(0, 10);
      downloadBlob(bundle.zipBlob, `modern-mesh-bundle-${timestamp}.zip`);
    } catch (error) {
      console.error('Download error:', error);
      alert('There was an error generating the bundle. Please try again.');
    }
    setProcessing(false);
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
      {/* Hidden file input - accessible from all steps */}
      <input
        id="file-upload"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleImageUpload}
        style={{ display: 'none' }}
      />

      {/* Header */}
      <header className="header">
        <div className="header-content">
          <a href={CONFIG.shopifyStoreUrl} className="logo">
            <svg className="logo-icon" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* M shape with mesh grid */}
              <path d="M8 52V18L30 36L52 18V52" stroke="currentColor" strokeWidth="4" fill="none"/>
              <path d="M8 18L20 28L30 20L40 28L52 18" stroke="currentColor" strokeWidth="4" fill="none"/>
              {/* Mesh grid in center */}
              <g stroke="currentColor" strokeWidth="0.5" opacity="0.7">
                {[0,1,2,3,4,5,6,7,8,9,10].map(i => (
                  <line key={`h${i}`} x1="18" y1={32 + i*2} x2="42" y2={32 + i*2}/>
                ))}
                {[0,1,2,3,4,5,6,7,8,9,10,11,12].map(i => (
                  <line key={`v${i}`} x1={18 + i*2} y1="32" x2={18 + i*2} y2="52"/>
                ))}
              </g>
            </svg>
            <span className="logo-text">MODERN MESH</span>
          </a>
          <nav className="nav">
            <a href={CONFIG.shopifyStoreUrl}>Back to Store</a>
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

              <label className="upload-area" htmlFor="file-upload">
                <div className="upload-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="upload-text">Tap to upload your photo</span>
                <span className="upload-hint">JPEG, PNG, or HEIC up to 20MB</span>
              </label>

              <div className="features">
                <div className="feature">
                  <span className="feature-icon">+</span>
                  <span>DMC color matching</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">+</span>
                  <span>Production-ready files</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">+</span>
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
                    <label htmlFor="file-upload" className="change-photo-btn">
                      Change Photo
                    </label>
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

                {/* Pattern Info */}
                {patternSpec && (
                  <div className="control-group">
                    <h3>Pattern Details</h3>
                    <div className="pattern-info">
                      <div className="info-row">
                        <span>Stitches</span>
                        <span>{patternSpec.stitchWidth} × {patternSpec.stitchHeight}</span>
                      </div>
                      <div className="info-row">
                        <span>Physical Size</span>
                        <span>{patternSpec.physicalWidthIn}" × {patternSpec.physicalHeightIn}"</span>
                      </div>
                      <div className="info-row">
                        <span>Total Stitches</span>
                        <span>{(patternSpec.stitchWidth * patternSpec.stitchHeight).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                )}

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
                      <span>Full color PDF included</span>
                    </div>
                    <div className="summary-total">
                      <span>Total</span>
                      <span className="price">${CANVAS_SIZES[settings.canvasSize].price}</span>
                    </div>

                    <button
                      className="checkout-btn"
                      onClick={handleCheckout}
                      disabled={uploadingToCloud || processing}
                    >
                      {uploadingToCloud ? (
                        <>
                          <span className="btn-spinner" />
                          Processing...
                        </>
                      ) : (
                        'Add to Cart'
                      )}
                    </button>

                    <div className="download-buttons">
                      <button className="download-btn" onClick={downloadPreview}>
                        Download Preview
                      </button>
                      <button className="download-btn" onClick={downloadBundle} disabled={processing}>
                        Download Production Bundle
                      </button>
                    </div>
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

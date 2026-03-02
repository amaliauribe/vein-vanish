const express = require('express');
const path = require('path');
const OpenAI = require('openai');
const multer = require('multer');
const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

// Load OpenAI key
require('dotenv').config({ path: '/root/clawd/.secrets/openai' });
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Process image with OpenAI
app.post('/api/process-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image uploaded' });
        }

        console.log('Processing image:', req.file.path);

        // Load the image
        const image = await loadImage(req.file.path);
        const w = Math.min(image.width, 1024);
        const h = Math.min(image.height, 1024);
        
        // Create canvas for the image (must be square for DALL-E)
        const size = Math.max(w, h);
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');
        
        // Fill with white and center the image
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        const offsetX = (size - w) / 2;
        const offsetY = (size - h) / 2;
        ctx.drawImage(image, offsetX, offsetY, w, h);

        // Create mask - detect veins and make those areas transparent
        const maskCanvas = createCanvas(size, size);
        const maskCtx = maskCanvas.getContext('2d');
        
        // Start with fully opaque (no edits)
        maskCtx.fillStyle = '#000000';
        maskCtx.fillRect(0, 0, size, size);
        
        // Get image data to detect veins
        const imageData = ctx.getImageData(0, 0, size, size);
        const maskData = maskCtx.getImageData(0, 0, size, size);
        const pixels = imageData.data;
        const mask = maskData.data;
        
        // Detect vein pixels and mark them as transparent in mask
        for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            
            const brightness = (r + g + b) / 3;
            
            // Detect skin area first
            const isSkin = r > 50 && brightness > 40 && brightness < 240 && r >= b * 0.6;
            
            if (isSkin) {
                // Detect veins (red, purple, blue tones)
                const hasRed = r > g * 1.1 && r > b * 1.1;
                const hasPurple = r > g && b > g * 0.8;
                const hasBlue = b > r * 0.75 || (g > r * 0.9 && b > r * 0.8);
                const isDarker = brightness < 170;
                
                const isVein = (hasRed || hasPurple || hasBlue) && isDarker;
                
                if (isVein) {
                    // Make this pixel transparent in mask (area to edit)
                    mask[i + 3] = 0; // Alpha = 0 (transparent = edit this area)
                }
            }
        }
        
        maskCtx.putImageData(maskData, 0, 0);
        
        // Dilate the mask slightly for better coverage
        const tempMask = maskCtx.getImageData(0, 0, size, size);
        for (let y = 1; y < size - 1; y++) {
            for (let x = 1; x < size - 1; x++) {
                const i = (y * size + x) * 4;
                // If any neighbor is transparent, make this transparent too
                const neighbors = [
                    ((y-1) * size + x) * 4,
                    ((y+1) * size + x) * 4,
                    (y * size + (x-1)) * 4,
                    (y * size + (x+1)) * 4
                ];
                for (const ni of neighbors) {
                    if (mask[ni + 3] === 0) {
                        tempMask.data[i + 3] = 0;
                        break;
                    }
                }
            }
        }
        maskCtx.putImageData(tempMask, 0, 0);

        // Save files for OpenAI
        const imagePath = '/tmp/vein_image.png';
        const maskPath = '/tmp/vein_mask.png';
        
        // Save image as PNG
        const imageBuffer = canvas.toBuffer('image/png');
        fs.writeFileSync(imagePath, imageBuffer);
        
        // Save mask as PNG
        const maskBuffer = maskCanvas.toBuffer('image/png');
        fs.writeFileSync(maskPath, maskBuffer);

        console.log('Calling OpenAI DALL-E edit...');

        // Call OpenAI Image Edit API
        const response = await openai.images.edit({
            model: "dall-e-2",
            image: fs.createReadStream(imagePath),
            mask: fs.createReadStream(maskPath),
            prompt: "Smooth healthy skin with natural skin tone, no visible veins or blemishes, photorealistic skin texture",
            n: 1,
            size: "1024x1024"
        });

        console.log('OpenAI response received');

        // Clean up temp files
        fs.unlinkSync(req.file.path);
        fs.unlinkSync(imagePath);
        fs.unlinkSync(maskPath);

        // Return the result URL
        res.json({ 
            success: true, 
            imageUrl: response.data[0].url 
        });

    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).json({ 
            error: 'Failed to process image', 
            details: error.message 
        });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', ai: 'openai' });
});

// Serve app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`VeinVanish AI running on port ${PORT}`);
});

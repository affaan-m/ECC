// Turns the user's reference file (image or video) into a JPEG/PNG the LLM and
// Veo can both consume. Videos are reduced to one representative frame.

const MAX_EDGE = 1280;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

function drawScaled(source, width, height) {
  if (!width || !height) throw new Error('Could not read the media dimensions');
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

async function imageToReference(file) {
  const dataUrl = await readAsDataUrl(file);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Invalid image'));
    img.src = dataUrl;
  });
  const jpeg = drawScaled(img, img.naturalWidth, img.naturalHeight);
  return { kind: 'image', mimeType: 'image/jpeg', base64: jpeg.split(',')[1], previewUrl: jpeg, name: file.name };
}

async function videoToReference(file) {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('Invalid video'));
    });
    video.currentTime = Math.min(1, video.duration / 3);
    await new Promise(resolve => {
      video.onseeked = resolve;
      setTimeout(resolve, 3000);
    });
    const jpeg = drawScaled(video, video.videoWidth, video.videoHeight);
    if (jpeg.length < 100) throw new Error('Could not extract a frame from the video');
    return { kind: 'video', mimeType: 'image/jpeg', base64: jpeg.split(',')[1], previewUrl: jpeg, name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function fileToReference(file) {
  if (!file) return null;
  if (file.type.startsWith('image/')) return imageToReference(file);
  if (file.type.startsWith('video/')) return videoToReference(file);
  throw new Error('Use an image or a video as reference');
}

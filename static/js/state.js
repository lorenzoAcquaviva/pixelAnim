// ── STATE ────────────────────────────────────────────────────────────────────
let animations = [];
let currentAnimId = null;
let frames = [];
let currentFrameIndex = 0;
let isDirty = false;
let tool = 'draw';
let isPainting = false;
let paintValue = 1;

// Preview
let previewTimer = null;
let previewFrame = 0;
let previewPlaying = true;

// Onion skin
let onionLayers = 3; // 0..3

type ViewBounds = {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
};

type WorkerResponse = {
	renderId: number;
	yStart: number;
	values: ArrayBuffer;
};

function getRequiredElement<T extends Element>(selector: string): T {
	const el = document.querySelector(selector);
	if (!el) {
		throw new Error(`Missing required DOM element: ${selector}`);
	}
	return el as T;
}

function getRequired2DContext(targetCanvas: HTMLCanvasElement): CanvasRenderingContext2D {
	const ctx = targetCanvas.getContext("2d", { alpha: false, desynchronized: true });
	if (!ctx) {
		throw new Error("2D canvas context unavailable.");
	}
	return ctx;
}

const canvas = getRequiredElement<HTMLCanvasElement>("[data-canvas]");
const xInput = getRequiredElement<HTMLInputElement>("[data-x]");
const yInput = getRequiredElement<HTMLInputElement>("[data-y]");
const iterationsInput = getRequiredElement<HTMLInputElement>("[data-iterations]");
const iterDoubleButton = getRequiredElement<HTMLButtonElement>("[data-iter-double]");
const iterHalfButton = getRequiredElement<HTMLButtonElement>("[data-iter-half]");
const panelToggleButton = getRequiredElement<HTMLButtonElement>("[data-panel-toggle]");
const panelEl = getRequiredElement<HTMLElement>(".panel");
const previewEnabledInput = getRequiredElement<HTMLInputElement>("[data-preview-enabled]");
const previewScaleSelect = getRequiredElement<HTMLSelectElement>("[data-preview-scale]");
const paletteSelect = getRequiredElement<HTMLSelectElement>("[data-palette]");
const workerUnlockInput = getRequiredElement<HTMLInputElement>("[data-worker-unlock]");
const workerCountSelect = getRequiredElement<HTMLSelectElement>("[data-worker-count-select]");
const resetButton = getRequiredElement<HTMLButtonElement>("[data-reset-button]");
const introOverlay = getRequiredElement<HTMLElement>("[data-intro]");
const introStartButton = getRequiredElement<HTMLButtonElement>("[data-intro-start]");
const resSelect = getRequiredElement<HTMLSelectElement>("[data-res-select]");
const resWidthInput = getRequiredElement<HTMLInputElement>("[data-res-width]");
const resHeightInput = getRequiredElement<HTMLInputElement>("[data-res-height]");
const reduceSizeInput = getRequiredElement<HTMLInputElement>("[data-reduce-size]");
const screenshotButton = getRequiredElement<HTMLButtonElement>("[data-screenshot]");
const renderMsEl = getRequiredElement<HTMLElement>("[data-render-ms]");
const workerCountEl = getRequiredElement<HTMLElement>("[data-worker-count]");
const renderStatusEl = getRequiredElement<HTMLElement>("[data-render-status]");
const canvasXEl = getRequiredElement<HTMLElement>("[data-canvas-x]");
const canvasYEl = getRequiredElement<HTMLElement>("[data-canvas-y]");
const realXEl = getRequiredElement<HTMLElement>("[data-real-x]");
const imagYEl = getRequiredElement<HTMLElement>("[data-imag-y]");
const minXEl = getRequiredElement<HTMLElement>("[data-min-x]");
const maxXEl = getRequiredElement<HTMLElement>("[data-max-x]");
const minYEl = getRequiredElement<HTMLElement>("[data-min-y]");
const maxYEl = getRequiredElement<HTMLElement>("[data-max-y]");

const ctx = getRequired2DContext(canvas);

const DEFAULT_CENTER = { x: -0.5, y: 0 };
const DEFAULT_HALF_HEIGHT = 1.6;
const DEFAULT_VIEW: ViewBounds = { minX: -2.1, maxX: 1.1, minY: -1.6, maxY: 1.6 };
const ZOOM_IN_FACTOR = 0.5;
const ZOOM_OUT_FACTOR = 2;
const FULL_RENDER_DELAY_MS = 140;
const PREVIEW_ITER_SCALE = 0.35;
const PREVIEW_SCALE_DEFAULT = 0.35;
const PALETTE_SIZE = 16384;

let currentPaletteName = paletteSelect.value;
let currentPalette = buildPalette(PALETTE_SIZE, currentPaletteName);
let previewEnabled = previewEnabledInput.checked;
let previewScale = Math.max(0.2, Math.min(0.9, Number.parseFloat(previewScaleSelect.value) || PREVIEW_SCALE_DEFAULT));

let view = { ...DEFAULT_VIEW };
let maxIter = Math.max(1, Number.parseInt(iterationsInput.value, 10) || 400);
let renderToken = 0;
let isDragging = false;
let dragMoved = false;
let dragStartPoint = { x: 0, y: 0 };
let dragCurrentPoint = { x: 0, y: 0 };
let dragStartView: ViewBounds = { ...DEFAULT_VIEW };
let dragPreviewCanvas: HTMLCanvasElement | null = null;
let wheelZoomTimer: number | null = null;
let wheelZoomAccum = 0;
let isTouchPanning = false;
let touchStartPoint = { x: 0, y: 0 };
let touchCurrentPoint = { x: 0, y: 0 };
let touchStartView: ViewBounds = { ...DEFAULT_VIEW };
let isRendering = false;
let lowResCanvas: HTMLCanvasElement | null = null;
let previewFrameQueued = false;
let activeRenderIter = maxIter;
let panelCollapsed = false;

function resizeCanvasToWindow() {
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
	canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
}

function syncPanelState() {
	panelEl.classList.toggle("collapsed", panelCollapsed);
	panelToggleButton.classList.toggle("collapsed", panelCollapsed);
}

function makeDefaultView(): ViewBounds {
	const aspect = canvas.width / canvas.height;
	const halfHeight = DEFAULT_HALF_HEIGHT;
	const halfWidth = halfHeight * aspect;
	return {
		minX: DEFAULT_CENTER.x - halfWidth,
		maxX: DEFAULT_CENTER.x + halfWidth,
		minY: DEFAULT_CENTER.y - halfHeight,
		maxY: DEFAULT_CENTER.y + halfHeight,
	};
}

function rebuildWorkers() {
	const manual = workerUnlockInput.checked;
	let nextCount = defaultWorkerCount;

	if (manual) {
		const parsed = Number.parseInt(workerCountSelect.value, 10);
		nextCount = Number.isFinite(parsed) && parsed > 0 ? parsed : defaultWorkerCount;
	}

	nextCount = Math.max(1, Math.min(16, nextCount));

	if (nextCount === workerCount) {
		return;
	}

	workers.forEach(worker => worker.terminate());
	workers = Array.from(
		{ length: nextCount },
		() => new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" })
	);
	workerCount = nextCount;
	workerCountEl.textContent = String(workerCount);
	renderWithMode();
}

const defaultWorkerCount = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1 || 1));
let workerCount = defaultWorkerCount;
workerCountEl.textContent = String(workerCount);
let workers = Array.from(
	{ length: workerCount },
	() => new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" })
);

function clamp01(value: number) {
	return Math.min(1, Math.max(0, value));
}

function sinebowColor(x: number): [number, number, number] {
	const t = clamp01(x);
	const r = Math.sin(Math.PI * (t + 0 / 3)) ** 2;
	const g = Math.sin(Math.PI * (t + 1 / 3)) ** 2;
	const b = Math.sin(Math.PI * (t + 2 / 3)) ** 2;
	return [r, g, b];
}

function turboColor(x: number): [number, number, number] {
	const t = clamp01(x);
	const t2 = t * t;
	const t3 = t2 * t;
	const t4 = t2 * t2;
	const t5 = t4 * t;

	const r =
		0.13572138 +
		4.6153926 * t +
		-42.66032258 * t2 +
		132.13108234 * t3 +
		-152.94239396 * t4 +
		59.28637943 * t5;
	const g =
		0.09140261 +
		2.19418839 * t +
		4.84296658 * t2 +
		-14.18503333 * t3 +
		4.27729857 * t4 +
		2.82956604 * t5;
	const b =
		0.1066733 +
		12.64194608 * t +
		-60.58204836 * t2 +
		110.36276771 * t3 +
		-89.90310912 * t4 +
		27.34824973 * t5;

	return [clamp01(r), clamp01(g), clamp01(b)];
}

function emberColor(x: number): [number, number, number] {
	const t = clamp01(x);
	const r = Math.min(1, 1.4 * t + 0.1);
	const g = Math.min(1, Math.pow(t, 1.4) * 0.9);
	const b = Math.min(1, Math.pow(t, 2.4) * 0.6);
	return [r, g, b];
}

function noirColor(x: number): [number, number, number] {
	const t = clamp01(x);
	const v = Math.pow(t, 0.7);
	return [v, v, v];
}

function buildPalette(size: number, mode: string): Uint8Array {
	const lut = new Uint8Array(size * 3);
	for (let i = 0; i < size; i++) {
		const t = i / (size - 1);
		let rgb: [number, number, number];
		switch (mode) {
			case "sinebow":
				rgb = sinebowColor(t);
				break;
			case "ember":
				rgb = emberColor(t);
				break;
			case "noir":
				rgb = noirColor(t);
				break;
			case "turbo":
			default:
				rgb = turboColor(t);
				break;
		}
		const [r, g, b] = rgb;
		lut[i * 3] = (r * 255) | 0;
		lut[i * 3 + 1] = (g * 255) | 0;
		lut[i * 3 + 2] = (b * 255) | 0;
	}
	return lut;
}

function screenToComplex(canvasX: number, canvasY: number) {
	return {
		re: view.minX + (canvasX / canvas.width) * (view.maxX - view.minX),
		im: view.minY + (canvasY / canvas.height) * (view.maxY - view.minY),
	};
}

function updateBoundsText() {
	minXEl.textContent = view.minX.toFixed(10);
	maxXEl.textContent = view.maxX.toFixed(10);
	minYEl.textContent = view.minY.toFixed(10);
	maxYEl.textContent = view.maxY.toFixed(10);

	const centerX = (view.minX + view.maxX) * 0.5;
	const centerY = (view.minY + view.maxY) * 0.5;
	xInput.value = centerX.toFixed(10);
	yInput.value = centerY.toFixed(10);
}

function paint(values: Float32Array, renderWidth: number, renderHeight: number) {
	const image = ctx.createImageData(renderWidth, renderHeight);
	const pixels = image.data;
	const paletteLen = currentPalette.length / 3 - 1;

	for (let i = 0, p = 0; i < values.length; i++, p += 4) {
		const m = values[i];
		if (m >= activeRenderIter) {
			pixels[p] = 0;
			pixels[p + 1] = 0;
			pixels[p + 2] = 0;
			pixels[p + 3] = 255;
			continue;
		}

		const tRaw = m / activeRenderIter;
		const t = tRaw * tRaw * (3 - 2 * tRaw);
		const pos = t * paletteLen;
		const idx0 = Math.floor(pos);
		const idx1 = Math.min(paletteLen, idx0 + 1);
		const mix = pos - idx0;
		const base0 = idx0 * 3;
		const base1 = idx1 * 3;

		const r0 = currentPalette[base0];
		const g0 = currentPalette[base0 + 1];
		const b0 = currentPalette[base0 + 2];
		const r1 = currentPalette[base1];
		const g1 = currentPalette[base1 + 1];
		const b1 = currentPalette[base1 + 2];

		pixels[p] = (r0 + (r1 - r0) * mix) | 0;
		pixels[p + 1] = (g0 + (g1 - g0) * mix) | 0;
		pixels[p + 2] = (b0 + (b1 - b0) * mix) | 0;
		pixels[p + 3] = 255;
	}

	if (renderWidth === canvas.width && renderHeight === canvas.height) {
		ctx.putImageData(image, 0, 0);
		return;
	}

	if (!lowResCanvas) {
		lowResCanvas = document.createElement("canvas");
	}
	lowResCanvas.width = renderWidth;
	lowResCanvas.height = renderHeight;
	const lowCtx = lowResCanvas.getContext("2d");
	if (!lowCtx) {
		ctx.putImageData(image, 0, 0);
		return;
	}
	lowCtx.putImageData(image, 0, 0);
	ctx.save();
	ctx.imageSmoothingEnabled = true;
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(lowResCanvas, 0, 0, canvas.width, canvas.height);
	ctx.restore();
}

function renderMandelbrot(scale = 1, iterScale = 1) {
	const token = ++renderToken;
	const start = performance.now();
	renderStatusEl.textContent = "rendering";
	isRendering = true;
	updateBoundsText();

	const width = Math.max(1, Math.floor(canvas.width * scale));
	const height = Math.max(1, Math.floor(canvas.height * scale));
	const values = new Float32Array(width * height);
	const iterForRender = Math.max(10, Math.floor(maxIter * iterScale));
	activeRenderIter = iterForRender;

	const rowsPerWorker = Math.ceil(height / workers.length);
	let completedWorkers = 0;
	let activeWorkers = 0;

	workers.forEach((worker, i) => {
		const yStart = i * rowsPerWorker;
		const yEnd = Math.min(height, yStart + rowsPerWorker);
		if (yStart >= yEnd) {
			completedWorkers += 1;
			return;
		}

		activeWorkers += 1;
		worker.onmessage = event => {
			const data = event.data as WorkerResponse;
			if (data.renderId !== token) {
				return;
			}

			const rowValues = new Float32Array(data.values);
			values.set(rowValues, data.yStart * width);

			completedWorkers += 1;
			if (completedWorkers === workers.length) {
				paint(values, width, height);
				renderMsEl.textContent = (performance.now() - start).toFixed(1);
				renderStatusEl.textContent = "done";
				workerCountEl.textContent = String(activeWorkers);
				isRendering = false;
			}
		};

		worker.postMessage({
			renderId: token,
			width,
			height,
			yStart,
			yEnd,
			maxIter: iterForRender,
			view,
		});
	});
}

function paintToContext(
	values: Float32Array,
	renderWidth: number,
	renderHeight: number,
	targetCtx: CanvasRenderingContext2D,
	iterForRender: number
) {
	const image = targetCtx.createImageData(renderWidth, renderHeight);
	const pixels = image.data;
	const paletteLen = currentPalette.length / 3 - 1;

	for (let i = 0, p = 0; i < values.length; i++, p += 4) {
		const m = values[i];
		if (m >= iterForRender) {
			pixels[p] = 0;
			pixels[p + 1] = 0;
			pixels[p + 2] = 0;
			pixels[p + 3] = 255;
			continue;
		}

		const tRaw = m / iterForRender;
		const t = tRaw * tRaw * (3 - 2 * tRaw);
		const pos = t * paletteLen;
		const idx0 = Math.floor(pos);
		const idx1 = Math.min(paletteLen, idx0 + 1);
		const mix = pos - idx0;
		const base0 = idx0 * 3;
		const base1 = idx1 * 3;

		const r0 = currentPalette[base0];
		const g0 = currentPalette[base0 + 1];
		const b0 = currentPalette[base0 + 2];
		const r1 = currentPalette[base1];
		const g1 = currentPalette[base1 + 1];
		const b1 = currentPalette[base1 + 2];

		pixels[p] = (r0 + (r1 - r0) * mix) | 0;
		pixels[p + 1] = (g0 + (g1 - g0) * mix) | 0;
		pixels[p + 2] = (b0 + (b1 - b0) * mix) | 0;
		pixels[p + 3] = 255;
	}

	targetCtx.putImageData(image, 0, 0);
}

async function renderScreenshot(width: number, height: number, reduceSize: boolean) {
	if (isRendering) {
		return;
	}

	isRendering = true;
	renderStatusEl.textContent = "rendering screenshot";
	screenshotButton.disabled = true;

	const iterForRender = Math.max(10, maxIter);
	const values = await new Promise<Float32Array>(resolve => {
		const token = ++renderToken;
		const rowsPerWorker = Math.ceil(height / workers.length);
		const buffer = new Float32Array(width * height);
		let completed = 0;

		workers.forEach((worker, i) => {
			const yStart = i * rowsPerWorker;
			const yEnd = Math.min(height, yStart + rowsPerWorker);
			if (yStart >= yEnd) {
				completed += 1;
				return;
			}

			worker.onmessage = event => {
				const data = event.data as WorkerResponse;
				if (data.renderId !== token) {
					return;
				}
				buffer.set(new Float32Array(data.values), data.yStart * width);
				completed += 1;
				if (completed === workers.length) {
					resolve(buffer);
				}
			};

			worker.postMessage({
				renderId: token,
				width,
				height,
				yStart,
				yEnd,
				maxIter: iterForRender,
				view,
			});
		});
	});

	const outCanvas = document.createElement("canvas");
	outCanvas.width = width;
	outCanvas.height = height;
	const outCtx = outCanvas.getContext("2d");
	if (!outCtx) {
		isRendering = false;
		screenshotButton.disabled = false;
		renderStatusEl.textContent = "done";
		return;
	}

	paintToContext(values, width, height, outCtx, iterForRender);

	const blob = await new Promise<Blob | null>(resolve => {
		if (reduceSize) {
			outCanvas.toBlob(resolve, "image/jpeg", 0.85);
		} else {
			outCanvas.toBlob(resolve, "image/png");
		}
	});

	if (blob) {
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `mandelbrot-${width}x${height}.${reduceSize ? "jpg" : "png"}`;
		link.click();
		URL.revokeObjectURL(url);
	}

	isRendering = false;
	screenshotButton.disabled = false;
	renderStatusEl.textContent = "done";
}

function zoomAt(canvasX: number, canvasY: number, factor: number) {
	const p = screenToComplex(canvasX, canvasY);
	const width = (view.maxX - view.minX) * factor;
	const height = (view.maxY - view.minY) * factor;

	view.minX = p.re - (canvasX / canvas.width) * width;
	view.maxX = view.minX + width;
	view.minY = p.im - (canvasY / canvas.height) * height;
	view.maxY = view.minY + height;
}

function getCanvasPointFromClient(clientX: number, clientY: number) {
	const rect = canvas.getBoundingClientRect();
	const x = ((clientX - rect.left) / rect.width) * canvas.width;
	const y = ((clientY - rect.top) / rect.height) * canvas.height;
	return {
		x: Math.max(0, Math.min(canvas.width - 1, x)),
		y: Math.max(0, Math.min(canvas.height - 1, y)),
	};
}

function renderPreviewThenFull() {
	if (previewEnabled) {
		renderMandelbrot(previewScale, PREVIEW_ITER_SCALE);
		return;
	}

	renderMandelbrot();
}

function renderWithMode() {
	if (previewEnabled) {
		renderMandelbrot(previewScale, PREVIEW_ITER_SCALE);
	} else {
		renderMandelbrot();
	}
}

function setResolutionInputs(width: number, height: number, disable: boolean) {
	resWidthInput.value = String(width);
	resHeightInput.value = String(height);
	resWidthInput.disabled = disable;
	resHeightInput.disabled = disable;
}

function getSelectedResolution() {
	const preset = resSelect.value;
	const presets: Record<string, [number, number]> = {
		current: [canvas.width, canvas.height],
		"480p": [854, 480],
		"720p": [1280, 720],
		"1080p": [1920, 1080],
		"1440p": [2560, 1440],
		"2k": [2048, 1080],
		"4k": [3840, 2160],
		"8k": [7680, 4320],
	};

	if (preset !== "custom" && presets[preset]) {
		return presets[preset];
	}

	const width = Math.max(64, Math.min(10000, Number.parseInt(resWidthInput.value, 10) || canvas.width));
	const height = Math.max(64, Math.min(10000, Number.parseInt(resHeightInput.value, 10) || canvas.height));
	return [width, height] as const;
}

function queuePreviewFrame() {
	if (!previewEnabled || previewFrameQueued) {
		return;
	}
	previewFrameQueued = true;
	requestAnimationFrame(() => {
		previewFrameQueued = false;
		renderMandelbrot(previewScale, PREVIEW_ITER_SCALE);
	});
}

canvas.addEventListener("mousemove", event => {
	const p = getCanvasPointFromClient(event.clientX, event.clientY);
	const c = screenToComplex(p.x, p.y);

	canvasXEl.textContent = p.x.toFixed(0);
	canvasYEl.textContent = p.y.toFixed(0);
	realXEl.textContent = c.re.toFixed(10);
	imagYEl.textContent = c.im.toFixed(10);
});

canvas.addEventListener(
	"wheel",
	event => {
		if (isRendering) {
			return;
		}
		event.preventDefault();
		const p = getCanvasPointFromClient(event.clientX, event.clientY);
		const delta = Math.max(-120, Math.min(120, event.deltaY));
		wheelZoomAccum += delta;

		const zoomFactor = Math.pow(1.0015, wheelZoomAccum);
		zoomAt(p.x, p.y, zoomFactor);
		wheelZoomAccum = 0;

		renderPreviewThenFull();

		if (wheelZoomTimer !== null) {
			window.clearTimeout(wheelZoomTimer);
		}
		wheelZoomTimer = window.setTimeout(() => {
			wheelZoomTimer = null;
		}, FULL_RENDER_DELAY_MS);
	},
	{ passive: false }
);

canvas.addEventListener("mousedown", event => {
	if (event.button !== 0) {
		return;
	}
	if (isRendering) {
		return;
	}

	const p = getCanvasPointFromClient(event.clientX, event.clientY);
	isDragging = true;
	dragMoved = false;
	dragStartPoint = p;
	dragCurrentPoint = p;
	dragStartView = { ...view };
	canvas.style.cursor = "grabbing";

	dragPreviewCanvas = document.createElement("canvas");
	dragPreviewCanvas.width = canvas.width;
	dragPreviewCanvas.height = canvas.height;
	const previewCtx = dragPreviewCanvas.getContext("2d");
	if (previewCtx) {
		previewCtx.drawImage(canvas, 0, 0);
	}
});

canvas.addEventListener("pointerdown", event => {
	if (event.pointerType !== "touch") {
		return;
	}
	if (isRendering) {
		return;
	}
	event.preventDefault();
	const p = getCanvasPointFromClient(event.clientX, event.clientY);
	isTouchPanning = true;
	touchStartPoint = p;
	touchCurrentPoint = p;
	touchStartView = { ...view };
	dragPreviewCanvas = document.createElement("canvas");
	dragPreviewCanvas.width = canvas.width;
	dragPreviewCanvas.height = canvas.height;
	const previewCtx = dragPreviewCanvas.getContext("2d");
	if (previewCtx) {
		previewCtx.drawImage(canvas, 0, 0);
	}
	canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", event => {
	if (!isTouchPanning || event.pointerType !== "touch") {
		return;
	}
	const p = getCanvasPointFromClient(event.clientX, event.clientY);
	touchCurrentPoint = p;

	const dx = p.x - touchStartPoint.x;
	const dy = p.y - touchStartPoint.y;
	const scaleX = (touchStartView.maxX - touchStartView.minX) / canvas.width;
	const scaleY = (touchStartView.maxY - touchStartView.minY) / canvas.height;

	view.minX = touchStartView.minX - dx * scaleX;
	view.maxX = touchStartView.maxX - dx * scaleX;
	view.minY = touchStartView.minY - dy * scaleY;
	view.maxY = touchStartView.maxY - dy * scaleY;

	if (dragPreviewCanvas) {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(dragPreviewCanvas, dx, dy);
	}

	queuePreviewFrame();
});

canvas.addEventListener("pointerup", event => {
	if (event.pointerType !== "touch") {
		return;
	}
	if (isTouchPanning) {
		const dx = touchCurrentPoint.x - touchStartPoint.x;
		const dy = touchCurrentPoint.y - touchStartPoint.y;
		const scaleX = (touchStartView.maxX - touchStartView.minX) / canvas.width;
		const scaleY = (touchStartView.maxY - touchStartView.minY) / canvas.height;

		view.minX = touchStartView.minX - dx * scaleX;
		view.maxX = touchStartView.maxX - dx * scaleX;
		view.minY = touchStartView.minY - dy * scaleY;
		view.maxY = touchStartView.maxY - dy * scaleY;
		renderPreviewThenFull();
	}
	isTouchPanning = false;
	dragPreviewCanvas = null;
	canvas.releasePointerCapture(event.pointerId);
});

window.addEventListener("mousemove", event => {
	if (!isDragging) {
		return;
	}

	const p = getCanvasPointFromClient(event.clientX, event.clientY);
	dragCurrentPoint = p;

	const dx = p.x - dragStartPoint.x;
	const dy = p.y - dragStartPoint.y;
	if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
		dragMoved = true;
	}

	if (dragPreviewCanvas) {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(dragPreviewCanvas, dx, dy);
	}

	queuePreviewFrame();
});

window.addEventListener("mouseup", event => {
	if (event.button !== 0) {
		return;
	}

	if (isDragging && dragMoved) {
		const dx = dragCurrentPoint.x - dragStartPoint.x;
		const dy = dragCurrentPoint.y - dragStartPoint.y;
		const scaleX = (dragStartView.maxX - dragStartView.minX) / canvas.width;
		const scaleY = (dragStartView.maxY - dragStartView.minY) / canvas.height;

		view.minX = dragStartView.minX - dx * scaleX;
		view.maxX = dragStartView.maxX - dx * scaleX;
		view.minY = dragStartView.minY - dy * scaleY;
		view.maxY = dragStartView.maxY - dy * scaleY;
		renderPreviewThenFull();
	}

	isDragging = false;
	dragPreviewCanvas = null;
	canvas.style.cursor = "crosshair";
});

canvas.addEventListener("click", event => {
	if (dragMoved) {
		dragMoved = false;
		return;
	}
	if (isRendering) {
		return;
	}

	const p = getCanvasPointFromClient(event.clientX, event.clientY);
	zoomAt(p.x, p.y, ZOOM_IN_FACTOR);
	renderWithMode();
});

canvas.addEventListener("contextmenu", event => {
	event.preventDefault();
	if (isRendering) {
		return;
	}
	const p = getCanvasPointFromClient(event.clientX, event.clientY);
	zoomAt(p.x, p.y, ZOOM_OUT_FACTOR);
	renderWithMode();
});

iterDoubleButton.addEventListener("click", () => {
	if (isRendering) {
		return;
	}
	maxIter = Math.min(10000, Math.max(1, Math.floor(maxIter * 2)));
	iterationsInput.value = String(maxIter);
	renderPreviewThenFull();
});

iterHalfButton.addEventListener("click", () => {
	if (isRendering) {
		return;
	}
	maxIter = Math.max(1, Math.floor(maxIter / 2));
	iterationsInput.value = String(maxIter);
	renderPreviewThenFull();
});

xInput.addEventListener("change", () => {
	const centerX = Number.parseFloat(xInput.value);
	if (!Number.isFinite(centerX)) return;
	const halfWidth = (view.maxX - view.minX) * 0.5;
	view.minX = centerX - halfWidth;
	view.maxX = centerX + halfWidth;
	renderWithMode();
});


yInput.addEventListener("change", () => {
	const centerY = Number.parseFloat(yInput.value);
	if (!Number.isFinite(centerY)) return;
	const halfHeight = (view.maxY - view.minY) * 0.5;
	view.minY = centerY - halfHeight;
	view.maxY = centerY + halfHeight;
	renderWithMode();
});

iterationsInput.addEventListener("change", () => {
	maxIter = Math.max(1, Number.parseInt(iterationsInput.value, 10) || 1);
	renderWithMode();
});

previewEnabledInput.addEventListener("change", () => {
	previewEnabled = previewEnabledInput.checked;
	renderWithMode();
});

introStartButton.addEventListener("click", () => {
	introOverlay.classList.add("hidden");
	renderWithMode();
});

panelToggleButton.addEventListener("click", () => {
	panelCollapsed = !panelCollapsed;
	syncPanelState();
});

workerUnlockInput.addEventListener("change", () => {
	const enabled = workerUnlockInput.checked;
	workerCountSelect.disabled = !enabled;
	if (!enabled) {
		workerCountSelect.value = "auto";
	}
	rebuildWorkers();
});

workerCountSelect.addEventListener("change", () => {
	rebuildWorkers();
});

previewScaleSelect.addEventListener("change", () => {
	const next = Number.parseFloat(previewScaleSelect.value);
	previewScale = Math.max(0.2, Math.min(0.9, Number.isFinite(next) ? next : PREVIEW_SCALE_DEFAULT));
	renderWithMode();
});

resSelect.addEventListener("change", () => {
	if (resSelect.value === "custom") {
		setResolutionInputs(canvas.width, canvas.height, false);
		return;
	}
	const [w, h] = getSelectedResolution();
	setResolutionInputs(w, h, true);
});

screenshotButton.addEventListener("click", () => {
	const [w, h] = getSelectedResolution();
	renderScreenshot(w, h, reduceSizeInput.checked);
});

paletteSelect.addEventListener("change", () => {
	if (isRendering) {
		return;
	}
	currentPaletteName = paletteSelect.value;
	currentPalette = buildPalette(PALETTE_SIZE, currentPaletteName);
	renderWithMode();
});

resetButton.addEventListener("click", () => {
	view = makeDefaultView();
	maxIter = Math.max(1, Number.parseInt(iterationsInput.value, 10) || 400);
	renderWithMode();
});

window.addEventListener("beforeunload", () => {
	workers.forEach(worker => worker.terminate());
});

window.addEventListener("resize", () => {
	resizeCanvasToWindow();
	view = makeDefaultView();
	syncPanelState();
	renderWithMode();
});

resizeCanvasToWindow();
view = makeDefaultView();
syncPanelState();
workerCountSelect.value = "auto";
renderWithMode();
setResolutionInputs(canvas.width, canvas.height, true);

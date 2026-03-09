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
	histogram: ArrayBuffer;
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
const resetButton = getRequiredElement<HTMLButtonElement>("[data-reset-button]");
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

const DEFAULT_VIEW: ViewBounds = { minX: -2, maxX: 1, minY: -1, maxY: 1 };
const ZOOM_IN_FACTOR = 0.5;
const ZOOM_OUT_FACTOR = 2;
const PALETTE = buildPalette(8192);

let view = { ...DEFAULT_VIEW };
let maxIter = Math.max(1, Number.parseInt(iterationsInput.value, 10) || 400);
let renderToken = 0;
let isDragging = false;
let dragMoved = false;
let dragStartPoint = { x: 0, y: 0 };
let dragCurrentPoint = { x: 0, y: 0 };
let dragStartView: ViewBounds = { ...DEFAULT_VIEW };
let dragPreviewCanvas: HTMLCanvasElement | null = null;

const workerCount = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1 || 1));
workerCountEl.textContent = String(workerCount);

const workers = Array.from(
	{ length: workerCount },
	() => new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" })
);

function buildPalette(size: number): Uint8Array {
	const lut = new Uint8Array(size * 3);
	for (let i = 0; i < size; i++) {
		const t = i / (size - 1);
		const phase = Math.PI * 2 * (0.5 + 1.25 * t);
		const sat = 0.82 + 0.18 * Math.sin(Math.PI * 2 * t);
		const val = 0.15 + 0.85 * t;
		const r = 0.5 + 0.5 * Math.sin(phase);
		const g = 0.5 + 0.5 * Math.sin(phase + 2.0943951023931953);
		const b = 0.5 + 0.5 * Math.sin(phase + 4.1887902047863905);

		lut[i * 3] = Math.min(255, (255 * val * (r * sat + (1 - sat))) | 0);
		lut[i * 3 + 1] = Math.min(255, (255 * val * (g * sat + (1 - sat))) | 0);
		lut[i * 3 + 2] = Math.min(255, (255 * val * (b * sat + (1 - sat))) | 0);
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

function paint(values: Float32Array, histogram: Uint32Array) {
	const image = ctx.createImageData(canvas.width, canvas.height);
	const pixels = image.data;
	const cdf = new Float32Array(maxIter + 1);

	let total = 0;
	for (let i = 0; i < maxIter; i++) {
		total += histogram[i];
	}

	if (total > 0) {
		let running = 0;
		for (let i = 0; i < maxIter; i++) {
			running += histogram[i];
			cdf[i] = running / total;
		}
		cdf[maxIter] = 1;
	}

	const paletteLen = PALETTE.length / 3 - 1;
	for (let i = 0, p = 0; i < values.length; i++, p += 4) {
		const m = values[i];
		if (m >= maxIter) {
			pixels[p] = 0;
			pixels[p + 1] = 0;
			pixels[p + 2] = 0;
			pixels[p + 3] = 255;
			continue;
		}

		const floorIdx = m | 0;
		const frac = m - floorIdx;
		const c0 = cdf[floorIdx] || 0;
		const c1 = cdf[Math.min(maxIter, floorIdx + 1)] || c0;
		const t = c0 + (c1 - c0) * frac;
		const lutIdx = Math.min(paletteLen, (t * paletteLen) | 0) * 3;

		pixels[p] = PALETTE[lutIdx];
		pixels[p + 1] = PALETTE[lutIdx + 1];
		pixels[p + 2] = PALETTE[lutIdx + 2];
		pixels[p + 3] = 255;
	}

	ctx.putImageData(image, 0, 0);
}

function renderMandelbrot() {
	const token = ++renderToken;
	const start = performance.now();
	renderStatusEl.textContent = "rendering";
	updateBoundsText();

	const width = canvas.width;
	const height = canvas.height;
	const values = new Float32Array(width * height);
	const histogram = new Uint32Array(maxIter + 1);

	const rowsPerWorker = Math.ceil(height / workers.length);
	let completed = 0;
	let activeWorkers = 0;

	workers.forEach((worker, i) => {
		const yStart = i * rowsPerWorker;
		const yEnd = Math.min(height, yStart + rowsPerWorker);
		if (yStart >= yEnd) {
			completed += 1;
			return;
		}

		activeWorkers += 1;
		worker.onmessage = event => {
			const data = event.data as WorkerResponse;
			if (data.renderId !== token) {
				return;
			}

			values.set(new Float32Array(data.values), data.yStart * width);
			const partialHistogram = new Uint32Array(data.histogram);
			for (let h = 0; h < partialHistogram.length; h++) {
				histogram[h] += partialHistogram[h];
			}

			completed += 1;
			if (completed === workers.length) {
				paint(values, histogram);
				renderMsEl.textContent = (performance.now() - start).toFixed(1);
				renderStatusEl.textContent = "done";
				workerCountEl.textContent = String(activeWorkers);
			}
		};

		worker.postMessage({
			renderId: token,
			width,
			height,
			yStart,
			yEnd,
			maxIter,
			view,
		});
	});
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

canvas.addEventListener("mousemove", event => {
	const p = getCanvasPointFromClient(event.clientX, event.clientY);
	const c = screenToComplex(p.x, p.y);

	canvasXEl.textContent = p.x.toFixed(0);
	canvasYEl.textContent = p.y.toFixed(0);
	realXEl.textContent = c.re.toFixed(10);
	imagYEl.textContent = c.im.toFixed(10);
});

canvas.addEventListener("mousedown", event => {
	if (event.button !== 0) {
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
		renderMandelbrot();
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

	const p = getCanvasPointFromClient(event.clientX, event.clientY);
	zoomAt(p.x, p.y, ZOOM_IN_FACTOR);
	renderMandelbrot();
});

canvas.addEventListener("contextmenu", event => {
	event.preventDefault();
	const p = getCanvasPointFromClient(event.clientX, event.clientY);
	zoomAt(p.x, p.y, ZOOM_OUT_FACTOR);
	renderMandelbrot();
});

xInput.addEventListener("change", () => {
	const centerX = Number.parseFloat(xInput.value);
	if (!Number.isFinite(centerX)) return;
	const halfWidth = (view.maxX - view.minX) * 0.5;
	view.minX = centerX - halfWidth;
	view.maxX = centerX + halfWidth;
	renderMandelbrot();
});

yInput.addEventListener("change", () => {
	const centerY = Number.parseFloat(yInput.value);
	if (!Number.isFinite(centerY)) return;
	const halfHeight = (view.maxY - view.minY) * 0.5;
	view.minY = centerY - halfHeight;
	view.maxY = centerY + halfHeight;
	renderMandelbrot();
});

iterationsInput.addEventListener("change", () => {
	maxIter = Math.max(1, Number.parseInt(iterationsInput.value, 10) || 1);
	renderMandelbrot();
});

resetButton.addEventListener("click", () => {
	view = { ...DEFAULT_VIEW };
	maxIter = Math.max(1, Number.parseInt(iterationsInput.value, 10) || 400);
	renderMandelbrot();
});

window.addEventListener("beforeunload", () => {
	workers.forEach(worker => worker.terminate());
});

renderMandelbrot();

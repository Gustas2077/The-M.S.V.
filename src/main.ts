const canvas = document.querySelector("[data-canvas]") as HTMLCanvasElement | null;
const xValue = document.querySelector("[data-x]") as HTMLInputElement | null;
const yValue = document.querySelector("[data-y]") as HTMLInputElement | null;
const iterationsInput = document.querySelector("[data-iterations]") as HTMLInputElement | null;
const resetButton = document.querySelector("[data-reset-button]") as HTMLButtonElement | null;

if (!canvas || !xValue || !yValue || !iterationsInput || !resetButton) {
	throw new Error("Required UI elements are missing.");
}

const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
if (!ctx) {
	throw new Error("2D canvas context unavailable.");
}

const DEFAULT_VIEW = {
	minX: -2,
	maxX: 1,
	minY: -1,
	maxY: 1,
};

const ZOOM_IN_FACTOR = 0.5;
const ZOOM_OUT_FACTOR = 2;
const PALETTE = buildPalette(8192);

let maxIter = Math.max(1, Number.parseInt(iterationsInput.value, 10) || 400);
let view = { ...DEFAULT_VIEW };
let renderToken = 0;

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

function escapeTimeSmooth(re: number, im: number): number {
	let zr = 0;
	let zi = 0;
	let zr2 = 0;
	let zi2 = 0;
	let n = 0;

	while (zr2 + zi2 <= 4 && n < maxIter) {
		zi = 2 * zr * zi + im;
		zr = zr2 - zi2 + re;
		zr2 = zr * zr;
		zi2 = zi * zi;
		n += 1;
	}

	if (n === maxIter) {
		return maxIter;
	}

	const magnitude2 = zr2 + zi2;
	const smooth = n + 1 - Math.log2(Math.log2(magnitude2));
	return Number.isFinite(smooth) ? smooth : n;
}

function screenToComplex(canvasX: number, canvasY: number) {
	return {
		re: view.minX + (canvasX / canvas.width) * (view.maxX - view.minX),
		im: view.minY + (canvasY / canvas.height) * (view.maxY - view.minY),
	};
}

function updateUIForCenter() {
	const centerX = (view.minX + view.maxX) * 0.5;
	const centerY = (view.minY + view.maxY) * 0.5;
	xValue.value = centerX.toFixed(8);
	yValue.value = centerY.toFixed(8);
	iterationsInput.value = String(maxIter);
}

function renderMandelbrot() {
	const token = ++renderToken;
	const width = canvas.width;
	const height = canvas.height;

	const values = new Float32Array(width * height);
	const histogram = new Uint32Array(maxIter + 1);
	const scaleX = (view.maxX - view.minX) / width;
	const scaleY = (view.maxY - view.minY) / height;

	let idx = 0;
	for (let y = 0; y < height; y++) {
		const im = view.minY + y * scaleY;
		for (let x = 0; x < width; x++) {
			const re = view.minX + x * scaleX;
			const m = escapeTimeSmooth(re, im);
			values[idx++] = m;
			if (m < maxIter) {
				histogram[m | 0] += 1;
			}
		}
	}

	if (token !== renderToken) {
		return;
	}

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

	const image = ctx.createImageData(width, height);
	const pixels = image.data;
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
	updateUIForCenter();
}

function calculateCanvasClick(event: MouseEvent) {
	const rect = canvas.getBoundingClientRect();
	const clickX = event.clientX - rect.left;
	const clickY = event.clientY - rect.top;
	const canvasX = (clickX / rect.width) * canvas.width;
	const canvasY = (clickY / rect.height) * canvas.height;
	return { x: canvasX, y: canvasY };
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

iterationsInput.addEventListener("change", () => {
	maxIter = Math.max(1, Number.parseInt(iterationsInput.value, 10) || 1);
	renderMandelbrot();
});

canvas.addEventListener("click", event => {
	const click = calculateCanvasClick(event);
	zoomAt(click.x, click.y, ZOOM_IN_FACTOR);
	renderMandelbrot();
});

canvas.addEventListener("contextmenu", event => {
	event.preventDefault();
	const click = calculateCanvasClick(event);
	zoomAt(click.x, click.y, ZOOM_OUT_FACTOR);
	renderMandelbrot();
});

xValue.addEventListener("change", () => {
	const nextX = Number.parseFloat(xValue.value);
	if (!Number.isFinite(nextX)) return;
	const halfWidth = (view.maxX - view.minX) * 0.5;
	view.minX = nextX - halfWidth;
	view.maxX = nextX + halfWidth;
	renderMandelbrot();
});

yValue.addEventListener("change", () => {
	const nextY = Number.parseFloat(yValue.value);
	if (!Number.isFinite(nextY)) return;
	const halfHeight = (view.maxY - view.minY) * 0.5;
	view.minY = nextY - halfHeight;
	view.maxY = nextY + halfHeight;
	renderMandelbrot();
});

resetButton.addEventListener("click", () => {
	view = { ...DEFAULT_VIEW };
	maxIter = Math.max(1, Number.parseInt(iterationsInput.value, 10) || 400);
	renderMandelbrot();
});

renderMandelbrot();
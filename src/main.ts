const canvas = document.querySelector("[data-canvas]") as HTMLCanvasElement;
const xValue = document.querySelector("[data-x]");
const yValue = document.querySelector("[data-y]");
const iterationsInput = document.querySelector(
	"[data-iterations]"
) as HTMLInputElement;
const resetButton = document.querySelector(
	"[data-reset-button]"
) as HTMLButtonElement;

const ctx = canvas.getContext("2d");

let canvasWidth = canvas.width; // Store the initial canvas width
let canvasHeight = canvas.height; // Store the initial canvas height

// Define initial zoom level
let zoomLevel = 1.9; // Initial zoom level

// Adjust the zoom factor to control zoom speed
const ZOOM_FACTOR = 2; // Adjust this value as needed

// Define the region of the complex plane to render
let RE_START = -2;
let RE_END = 2;
let IM_START = -2;
let IM_END = 2;

let x = -0.5;
let y = 0;

// Define the maximum number of iterations
let MAX_ITER = 1000; // You can adjust this value

function mandelbrot(c: { real: number; imaginary: number }) {
	let z = { real: 0, imaginary: 0 };
	let n = 0;

	while (z.real * z.real + z.imaginary * z.imaginary <= 4 && n < MAX_ITER) {
		const tempReal = z.real * z.real - z.imaginary * z.imaginary + c.real;
		const tempImaginary = 2 * z.real * z.imaginary + c.imaginary;
		z.real = tempReal;
		z.imaginary = tempImaginary;
		n++;
	}

	return n;
}

function renderMandelbrot() {
	if (!ctx) return;

	// Clear the canvas
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	// Calculate the region of the complex plane based on user-defined parameters
	const halfWidth = (RE_END - RE_START) / 2;
	const halfHeight = (IM_END - IM_START) / 2;
	RE_START = x - halfWidth / zoomLevel;
	RE_END = x + halfWidth / zoomLevel;
	IM_START = y - halfHeight / zoomLevel;
	IM_END = y + halfHeight / zoomLevel;

	if (!xValue || !yValue) return;

	// Update display values
	xValue.textContent = x.toFixed(2); // Update display for X
	yValue.textContent = y.toFixed(2); // Update display for Y

	// Calculate a factor based on zoom level for coloring
	const colorFactor = zoomLevel;

	// Render the Mandelbrot set with the current parameters
	for (let x = 0; x < canvas.width; x++) {
		for (let y = 0; y < canvas.height; y++) {
			const c = {
				real: RE_START + (x / canvas.width) * (RE_END - RE_START),
				imaginary: IM_START + (y / canvas.height) * (IM_END - IM_START),
			};

			const m = mandelbrot(c);

			// Set the pixel color based on the number of iterations and zoom level
			ctx.fillStyle =
				m === MAX_ITER
					? "black"
					: `hsl(${
							((m % MAX_ITER) / MAX_ITER) * 360 * colorFactor
					  }, 100%, 50%)`;
			ctx.fillRect(x, y, 1, 1);
		}
	}
}

// Event listener for the "Zoom In" button
iterationsInput.addEventListener("blur", () => {
	// Get the user-defined iterations
	const newIterations = parseInt(iterationsInput.value);

	// Ensure it's not zero or negative
	if (newIterations <= 0) iterationsInput.value = "1";

	// Update the MAX_ITER value
	MAX_ITER = parseInt(iterationsInput.value);

	// Trigger canvas rendering
	renderMandelbrot();
});

// Function to calculate click coordinates relative to canvas size
function calculateCanvasClick(event: MouseEvent) {
	const rect = canvas.getBoundingClientRect();
	const clickX = event.clientX - rect.left;
	const clickY = event.clientY - rect.top;
	const canvasX = (clickX / rect.width) * canvasWidth;
	const canvasY = (clickY / rect.height) * canvasHeight;
	return { x: canvasX, y: canvasY };
}

// Event listener for canvas click
canvas.addEventListener("click", event => {
	// Calculate the complex coordinate corresponding to the pointer position
	const click = calculateCanvasClick(event);
	const clickC = {
		real: RE_START + (click.x / canvasWidth) * (RE_END - RE_START),
		imaginary: IM_START + (click.y / canvasHeight) * (IM_END - IM_START),
	};

	// Calculate the new zoom level with reduced zoom factor
	const newZoomLevel = zoomLevel / ZOOM_FACTOR;

	// Ensure the new zoom level is within bounds
	if (newZoomLevel >= 1) {
		zoomLevel = newZoomLevel;
	}

	// Adjust the position centered around the pointer's position
	x = clickC.real;
	y = clickC.imaginary;

	// Trigger canvas rendering
	renderMandelbrot();
});

// Event listener for the "Reset Image" button
resetButton.addEventListener("click", () => {
	// Reload the page to reset the image
	window.location.href = window.location.href;
});

// Initial rendering
renderMandelbrot();

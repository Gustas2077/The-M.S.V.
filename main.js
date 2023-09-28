import { Complex } from "mathjs";

const canvas = document.getElementById("mandelbrotCanvas");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// Define initial zoom level
let zoomLevel = 1.5; // Initial zoom level

// Adjust the zoom factor to control zoom speed
const ZOOM_FACTOR = 10; // Adjust this value as needed

// Define the region of the complex plane to render
let RE_START = -2;
let RE_END = 2;
let IM_START = -2;
let IM_END = 2;

let x = -0.5;
let y = 0;

// Display elements
const xValue = document.getElementById("xValue");
const yValue = document.getElementById("yValue");
const iterationsInput = document.getElementById("iterationsInput");
const generateButton = document.getElementById("generateButton");
const resetImageButton = document.getElementById("resetImageButton");
const statusText = document.getElementById("statusText");

// Define the maximum number of iterations
let MAX_ITER = 1000; // You can adjust this value

function mandelbrot(c) {
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
  // Clear the canvas
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // Calculate the region of the complex plane based on user-defined parameters
  const halfWidth = (RE_END - RE_START) / 2;
  const halfHeight = (IM_END - IM_START) / 2;
  RE_START = x - halfWidth / zoomLevel;
  RE_END = x + halfWidth / zoomLevel;
  IM_START = y - halfHeight / zoomLevel;
  IM_END = y + halfHeight / zoomLevel;

  // Update display values
  xValue.textContent = x.toFixed(2); // Update display for X
  yValue.textContent = y.toFixed(2); // Update display for Y

  // Calculate a factor based on zoom level for coloring
  const colorFactor = zoomLevel;

  // Render the Mandelbrot set with the current parameters
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < HEIGHT; y++) {
      const c = {
        real: RE_START + (x / WIDTH) * (RE_END - RE_START),
        imaginary: IM_START + (y / HEIGHT) * (IM_END - IM_START),
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

iterationsInput.addEventListener("input", () => {
  // Get the user-defined iterations
  const newIterations = parseInt(iterationsInput.value);

  // Ensure it's not zero or negative
  if (newIterations <= 0) {
    iterationsInput.value = "1"; // Set it to 1 (or any minimum value you prefer)
  }

  // Update the MAX_ITER value
  MAX_ITER = parseInt(iterationsInput.value);

  // Trigger canvas rendering
  renderMandelbrot();
});

// Event listener for canvas click
canvas.addEventListener("click", handleCanvasClick);

// Function to handle canvas click
function handleCanvasClick(event) {
  // Calculate the complex coordinate corresponding to the pointer position
  const clickX = event.clientX - canvas.getBoundingClientRect().left;
  const clickY = event.clientY - canvas.getBoundingClientRect().top;
  const clickC = {
    real: RE_START + (clickX / WIDTH) * (RE_END - RE_START),
    imaginary: IM_START + (clickY / HEIGHT) * (IM_END - IM_START),
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
}

// Add a click event listener to the "Generate" button
generateButton.addEventListener("click", () => {
  // Reset the zoom level to the initial value
  zoomLevel = 1.0;
  renderMandelbrot();
});

// Event listener for the "Reset Image" button
resetImageButton.addEventListener("click", () => {
  // Reload the page to reset the image
  window.location.href = window.location.href;
});

// Initial rendering
renderMandelbrot();

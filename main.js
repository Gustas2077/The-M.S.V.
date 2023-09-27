import { Complex } from "mathjs";

const canvas = document.getElementById("mandelbrotCanvas");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const MAX_ITER = 1000;

// Define the region of the complex plane to render
const RE_START = -2;
const RE_END = 2;
const IM_START = -2;
const IM_END = 2;

// Define a color map (an array of colors)
const colorMap = [
  [0, 0, 0], // Color for iterations = 0 (black)
  [255, 0, 0], // Color for iterations = 1 (red)
  [0, 255, 0], // Color for iterations = 2 (green)
  [0, 0, 255], // Color for iterations = 3 (blue)
  [255, 255, 0], // Color for iterations = 4 (yellow)
  // Add more colors as needed
];

function getColor(iterations) {
  const index = iterations % colorMap.length;
  return colorMap[index];
}

function mandelbrot(c) {
  let z = new Complex(0, 0);
  let n = 0;

  while (z.abs() <= 2 && n < MAX_ITER) {
    z = z.mul(z).add(c);
    n++;
  }

  return n;
}

// Render the Mandelbrot set with a colorful gradient
for (let x = 0; x < WIDTH; x++) {
  for (let y = 0; y < HEIGHT; y++) {
    const c = new Complex(
      RE_START + (x / WIDTH) * (RE_END - RE_START),
      IM_START + (y / HEIGHT) * (IM_END - IM_START)
    );

    const m = mandelbrot(c);

    // Get the color based on the number of iterations
    const color = getColor(m);

    // Set the pixel color
    ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

function renderMandelbrot() {
  // Clear the canvas
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // Render the Mandelbrot set with the current zoom and region
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < HEIGHT; y++) {
      const c = new Complex(
        RE_START + (x / WIDTH) * (RE_END - RE_START),
        IM_START + (y / HEIGHT) * (IM_END - IM_START)
      );

      const m = mandelbrot(c);

      // Get the color based on the number of iterations
      const color = getColor(m);

      // Set the pixel color
      ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

// Function to handle zoom in
function zoomIn() {
  zoomLevel /= zoomFactor;
  RE_START /= zoomFactor;
  RE_END /= zoomFactor;
  IM_START /= zoomFactor;
  IM_END /= zoomFactor;
  renderMandelbrot();
}

// Function to handle zoom out
function zoomOut() {
  zoomLevel *= zoomFactor;
  RE_START *= zoomFactor;
  RE_END *= zoomFactor;
  IM_START *= zoomFactor;
  IM_END *= zoomFactor;
  renderMandelbrot();
}

// Zoom in and out button event listeners
document.getElementById("zoomInButton").addEventListener("click", zoomIn);
document.getElementById("zoomOutButton").addEventListener("click", zoomOut);

// Initial rendering
renderMandelbrot();

type RenderJob = {
	renderId: number;
	width: number;
	height: number;
	yStart: number;
	yEnd: number;
	maxIter: number;
	view: {
		minX: number;
		maxX: number;
		minY: number;
		maxY: number;
	};
};

type WorkerScopeLike = {
	onmessage: ((event: MessageEvent<RenderJob>) => void) | null;
	postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const workerScope = self as unknown as WorkerScopeLike;

workerScope.onmessage = (event: MessageEvent<RenderJob>) => {
	const { renderId, width, height, yStart, yEnd, maxIter, view } = event.data;

	const rowCount = yEnd - yStart;
	const values = new Float32Array(width * rowCount);

	const scaleX = (view.maxX - view.minX) / width;
	const scaleY = (view.maxY - view.minY) / height;

	let idx = 0;
	for (let y = yStart; y < yEnd; y++) {
		const im = view.minY + y * scaleY;
		for (let x = 0; x < width; x++) {
			const re = view.minX + x * scaleX;

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

			let smooth = maxIter;
			if (n < maxIter) {
				smooth = n + 1 - Math.log2(Math.log2(zr2 + zi2));
				if (!Number.isFinite(smooth)) {
					smooth = n;
				}
			}

			values[idx++] = smooth;
		}
	}

	workerScope.postMessage({ renderId, yStart, values: values.buffer }, [values.buffer]);
};

export {};

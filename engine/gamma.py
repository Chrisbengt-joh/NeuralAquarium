import json
import math
import random


class Matrix:
    def __init__(self, rows, cols):
        self._d = [[0.0] * cols for _ in range(rows)]
        self._r = rows
        self._c = cols

    def randomize(self, lo=-1.0, hi=1.0):
        for i in range(self._r):
            for j in range(self._c):
                self._d[i][j] = random.uniform(lo, hi)
        return self

    def get(self, i, j):
        return self._d[i][j]

    def set(self, i, j, v):
        self._d[i][j] = v

    def multiply(self, other):
        assert self._c == other._r
        result = Matrix(self._r, other._c)
        for i in range(self._r):
            for j in range(other._c):
                s = 0.0
                for k in range(self._c):
                    s += self._d[i][k] * other._d[k][j]
                result._d[i][j] = s
        return result

    def apply_fn(self, fn):
        result = Matrix(self._r, self._c)
        for i in range(self._r):
            for j in range(self._c):
                result._d[i][j] = fn(self._d[i][j])
        return result

    def add(self, other):
        result = Matrix(self._r, self._c)
        for i in range(self._r):
            for j in range(self._c):
                result._d[i][j] = self._d[i][j] + other._d[i][j]
        return result

    def transpose(self):
        result = Matrix(self._c, self._r)
        for i in range(self._r):
            for j in range(self._c):
                result._d[j][i] = self._d[i][j]
        return result

    def to_list(self):
        if self._c == 1:
            return [self._d[i][0] for i in range(self._r)]
        return [row[:] for row in self._d]

    @staticmethod
    def from_list(data):
        if isinstance(data[0], list):
            m = Matrix(len(data), len(data[0]))
            m._d = [row[:] for row in data]
        else:
            m = Matrix(len(data), 1)
            for i, v in enumerate(data):
                m._d[i][0] = v
        return m


class Processor:
    def __init__(self, layer_sizes):
        self._layers = []
        self._biases = []
        self._layer_sizes = layer_sizes
        for i in range(len(layer_sizes) - 1):
            w = Matrix(layer_sizes[i + 1], layer_sizes[i]).randomize(-0.5, 0.5)
            b = Matrix(layer_sizes[i + 1], 1).randomize(-0.2, 0.2)
            self._layers.append(w)
            self._biases.append(b)
        self._activation_cache = []
        self._training_history = []
        self._total_trained = 0

    def _sigma(self, x):
        return 1.0 / (1.0 + math.exp(-max(-500, min(500, x))))

    def _sigma_prime(self, x):
        s = self._sigma(x)
        return s * (1.0 - s)

    def forward(self, input_data):
        current = Matrix.from_list(input_data)
        self._activation_cache = [current]
        for i, (w, b) in enumerate(zip(self._layers, self._biases)):
            z = w.multiply(current).add(b)
            current = z.apply_fn(self._sigma)
            self._activation_cache.append(current)
        return current.to_list()

    def evaluate(self, dataset):
        total_err = 0.0
        for inp, target in dataset:
            output = self.forward(inp)
            for o, t in zip(output, target):
                total_err += (o - t) ** 2
        return total_err / len(dataset)

    def train_step(self, inp, target, lr=0.1):
        output = self.forward(inp)
        output_m = Matrix.from_list(output)
        target_m = Matrix.from_list(target)

        delta = Matrix(output_m._r, 1)
        for i in range(delta._r):
            err = output_m.get(i, 0) - target_m.get(i, 0)
            deriv = output_m.get(i, 0) * (1.0 - output_m.get(i, 0))
            delta.set(i, 0, err * deriv)

        for l in range(len(self._layers) - 1, -1, -1):
            a_prev = self._activation_cache[l]
            grad_w = delta.multiply(a_prev.transpose())

            for i in range(self._layers[l]._r):
                for j in range(self._layers[l]._c):
                    self._layers[l]._d[i][j] -= lr * grad_w.get(i, j)
                self._biases[l]._d[i][0] -= lr * delta.get(i, 0)

            if l > 0:
                w_t = self._layers[l].transpose()
                new_delta = w_t.multiply(delta)
                a = self._activation_cache[l]
                for i in range(new_delta._r):
                    new_delta._d[i][0] *= a.get(i, 0) * (1.0 - a.get(i, 0))
                delta = new_delta

        self._total_trained += 1

    def train_batch(self, dataset, epochs=5, lr=0.1):
        errors = []
        for ep in range(epochs):
            err = 0
            for inp, target in dataset:
                self.train_step(inp, target, lr)
                out = self.forward(inp)
                for o, t in zip(out, target):
                    err += (o - t) ** 2
            avg_err = err / max(len(dataset), 1)
            errors.append(avg_err)
            self._training_history.append(
                {"epoch": self._total_trained, "error": round(avg_err, 6)}
            )
        return errors

    def get_training_stats(self):
        return {
            "total_trained": self._total_trained,
            "history": self._training_history[-30:],
            "layers": self._layer_sizes,
            "current_error": self._training_history[-1]["error"]
            if self._training_history
            else None,
        }

    def serialize(self):
        return {
            "layers": [l.to_list() for l in self._layers],
            "biases": [b.to_list() for b in self._biases],
        }

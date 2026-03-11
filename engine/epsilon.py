import math
import random


class Sampler:
    def __init__(self, seed=None):
        self._rng = random.Random(seed)
        self._cache = {}
        self._chains = {}

    def build_chain(self, name, corpus, order=2):
        chain = {}
        for i in range(len(corpus) - order):
            key = tuple(corpus[i : i + order])
            nxt = corpus[i + order]
            if key not in chain:
                chain[key] = []
            chain[key].append(nxt)
        self._chains[name] = {"data": chain, "order": order}

    def walk(self, name, steps=50, start=None):
        if name not in self._chains:
            return []
        chain = self._chains[name]["data"]
        order = self._chains[name]["order"]
        if not chain:
            return []
        if start and tuple(start) in chain:
            current = list(start)
        else:
            current = list(self._rng.choice(list(chain.keys())))
        result = current[:]
        for _ in range(steps):
            key = tuple(result[-order:])
            if key not in chain:
                key = self._rng.choice(list(chain.keys()))
            nxt = self._rng.choice(chain[key])
            result.append(nxt)
        return result

    def perlin_1d(self, length, octaves=4, persistence=0.5):
        def fade(t):
            return t * t * t * (t * (t * 6 - 15) + 10)

        def lerp(a, b, t):
            return a + t * (b - a)

        output = [0.0] * length
        amp = 1.0
        freq = 1.0
        max_val = 0.0

        for _ in range(octaves):
            grad = [
                self._rng.uniform(-1, 1) for _ in range(int(length * freq / 10) + 2)
            ]
            for i in range(length):
                pos = i * freq / length * (len(grad) - 1)
                idx = int(pos)
                frac = pos - idx
                idx = min(idx, len(grad) - 2)
                f = fade(frac)
                val = lerp(grad[idx] * frac, grad[idx + 1] * (frac - 1), f)
                output[i] += val * amp
            max_val += amp
            amp *= persistence
            freq *= 2

        return [v / max_val for v in output]

    def cluster(self, points, k=3, iterations=20):
        if not points or k <= 0:
            return []
        dim = len(points[0])
        centroids = [list(self._rng.choice(points)) for _ in range(k)]
        assignments = [0] * len(points)

        for _ in range(iterations):
            for i, p in enumerate(points):
                best_dist = float("inf")
                best_c = 0
                for c_idx, c in enumerate(centroids):
                    d = sum((a - b) ** 2 for a, b in zip(p, c))
                    if d < best_dist:
                        best_dist = d
                        best_c = c_idx
                assignments[i] = best_c

            for c_idx in range(k):
                members = [
                    points[i] for i in range(len(points)) if assignments[i] == c_idx
                ]
                if members:
                    for d in range(dim):
                        centroids[c_idx][d] = sum(m[d] for m in members) / len(members)

        groups = {i: [] for i in range(k)}
        for i, a in enumerate(assignments):
            groups[a].append(points[i])
        return {"centroids": centroids, "groups": groups, "assignments": assignments}

    def reduce_dimensions(self, points, target_dim=2):
        if not points:
            return []
        dim = len(points[0])
        projection = [
            [self._rng.gauss(0, 1) for _ in range(dim)] for _ in range(target_dim)
        ]
        for i in range(target_dim):
            norm = math.sqrt(sum(x * x for x in projection[i]))
            projection[i] = [x / (norm + 1e-10) for x in projection[i]]

        result = []
        for p in points:
            new_p = []
            for proj in projection:
                val = sum(a * b for a, b in zip(p, proj))
                new_p.append(round(val, 4))
            result.append(new_p)
        return result

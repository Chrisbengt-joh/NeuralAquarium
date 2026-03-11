import hashlib
import math
import random
import time


def generate_collection(n=40):
    rng = random.Random(42)
    palette = [
        "#e74c3c",
        "#3498db",
        "#2ecc71",
        "#f39c12",
        "#9b59b6",
        "#1abc9c",
        "#e67e22",
        "#34495e",
        "#e84393",
        "#00cec9",
        "#6c5ce7",
        "#fd79a8",
        "#ffeaa7",
        "#dfe6e9",
        "#b2bec3",
    ]
    labels = []
    for i in range(n):
        h = hashlib.md5(f"entity_{i}_{rng.random()}".encode()).hexdigest()[:6]
        labels.append(h)

    items = []
    num_groups = rng.randint(3, 6)
    group_names = [f"g{i}" for i in range(num_groups)]

    for i in range(n):
        g = group_names[rng.randint(0, num_groups - 1)]
        angle = rng.uniform(0, math.pi * 2)
        radius = rng.gauss(0, 1)

        items.append(
            {
                "label": labels[i],
                "g": g,
                "w": round(rng.uniform(0.1, 10.0), 2),
                "v": [
                    round(math.cos(angle) * radius * 50 + rng.gauss(0, 20), 2),
                    round(math.sin(angle) * radius * 50 + rng.gauss(0, 20), 2),
                    round(rng.uniform(-30, 30), 2),
                    round(rng.gauss(0, 15), 2),
                ],
                "hue": palette[rng.randint(0, len(palette) - 1)],
                "r": round(rng.uniform(3, 18), 1),
                "edges": [],
            }
        )

    for i in range(n):
        num_edges = rng.randint(1, 4)
        candidates = list(range(n))
        candidates.remove(i)
        targets = rng.sample(candidates, min(num_edges, len(candidates)))
        items[i]["edges"] = targets

    return items


def generate_sequence(length=500):
    rng = random.Random(99)
    symbols = list("ABCDEFGHIJKLMNOP")
    weights = [rng.uniform(0.5, 3.0) for _ in symbols]
    total = sum(weights)
    probs = [w / total for w in weights]

    seq = []
    for _ in range(length):
        r = rng.random()
        cumulative = 0
        for sym, p in zip(symbols, probs):
            cumulative += p
            if r <= cumulative:
                seq.append(sym)
                break
    return seq


def generate_vectors(n=60, dim=4):
    rng = random.Random(77)
    centers = [[rng.gauss(0, 30) for _ in range(dim)] for _ in range(4)]
    points = []
    for _ in range(n):
        c = rng.choice(centers)
        p = [round(c[d] + rng.gauss(0, 8), 3) for d in range(dim)]
        points.append(p)
    return points

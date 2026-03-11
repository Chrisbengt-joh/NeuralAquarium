import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import math
import random

from flask import Flask, jsonify, render_template, request

from core.alpha import Field, NodeEntity
from core.beta import Vault
from data.seed import generate_collection, generate_sequence, generate_vectors
from engine.delta import Pool
from engine.epsilon import Sampler
from engine.gamma import Matrix, Processor

app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), "templates"),
    static_folder=os.path.join(os.path.dirname(__file__), "static"),
)

field = Field(w=1200, h=800)
vault = Vault()
sampler = Sampler(seed=42)
processor = Processor([4, 12, 8, 4])

collection = generate_collection(40)
vault.ingest(collection)
sequence = generate_sequence(500)
vectors = generate_vectors(60, 4)

sampler.build_chain("seq", sequence, order=2)
clusters = sampler.cluster(vectors, k=4)
reduced = sampler.reduce_dimensions(vectors, 2)

node_map = {}
for i, item in enumerate(collection):
    n = field.spawn(tag=item["label"])
    n._x = 600 + item["v"][0] * 2
    n._y = 400 + item["v"][1] * 2
    node_map[i] = n

for i, item in enumerate(collection):
    for target in item["edges"]:
        if target in node_map:
            try:
                field.connect(node_map[i], node_map[target], k=0.005, rest=120)
            except:
                pass

pool = Pool(size=20, strand_length=8, bounds=[(-5, 5)] * 8)
training_data = []


def gather_training_sample():
    alive = [n for n in field._nodes if n._alive]
    if len(alive) < 4:
        return
    avg_energy = sum(n._energy for n in alive) / len(alive)
    avg_age = sum(n._age for n in alive) / len(alive)
    spread_x = max(n._x for n in alive) - min(n._x for n in alive)
    spread_y = max(n._y for n in alive) - min(n._y for n in alive)

    inp = [
        avg_energy / 150.0,
        avg_age / 200.0,
        spread_x / field._w,
        spread_y / field._h,
    ]

    health = avg_energy / 100.0
    density = 1.0 - (spread_x * spread_y) / (field._w * field._h + 1)
    survival = len(alive) / max(len(field._nodes) + len(field._graveyard), 1)
    balance = 1.0 - abs(field._births - field._deaths) / max(
        field._births + field._deaths, 1
    )

    target = [
        min(1, max(0, health)),
        min(1, max(0, density)),
        min(1, max(0, survival)),
        min(1, max(0, balance)),
    ]

    training_data.append((inp, target))
    if len(training_data) > 100:
        training_data.pop(0)


def build_response():
    snap = field.snapshot()
    nodes_out = []
    for nd in snap["nodes"]:
        nodes_out.append(
            {
                "x": nd["x"],
                "y": nd["y"],
                "label": nd.get("t", "?"),
                "group": "live" if nd.get("alive", True) else "dead",
                "w": nd.get("energy", 0),
                "hue": "#4488aa",
                "r": max(3, nd.get("energy", 50) / 10),
                "energy": nd.get("energy", 0),
                "age": nd.get("age", 0),
                "alive": nd.get("alive", True),
                "gen": nd.get("gen", 0),
                "trail": nd.get("trail", []),
                "dna": nd.get("dna", {}),
            }
        )

    edges_out = []
    for nd in snap["nodes"]:
        src = nd["id"]
        for tgt in nd.get("c", []):
            if tgt >= 0:
                edges_out.append([src, tgt])

    nn_stats = processor.get_training_stats()
    pool_stats = pool.get_stats()

    meta = {
        "alive": sum(1 for n in nodes_out if n["alive"]),
        "epoch": snap["epoch"],
        "births": snap.get("births", 0),
        "deaths": snap.get("deaths", 0),
        "avg_energy": round(
            sum(n["energy"] for n in nodes_out) / max(len(nodes_out), 1), 1
        ),
        "avg_age": round(sum(n["age"] for n in nodes_out) / max(len(nodes_out), 1), 1),
        "max_gen": max((n["gen"] for n in nodes_out), default=0),
        "nn_trained": nn_stats["total_trained"],
        "nn_error": nn_stats["current_error"],
        "evo_gen": pool_stats["generation"],
        "evo_best": round(pool_stats["best_score"], 3)
        if pool_stats["best_score"]
        else 0,
    }
    return {
        "nodes": nodes_out,
        "edges": edges_out,
        "epoch": snap["epoch"],
        "meta": meta,
        "nn_history": nn_stats["history"][-20:],
        "pool_history": pool_stats["history"][-20:],
    }


def energy_to_color(energy):
    if energy > 100:
        r, g, b = 50, 255, 150
    elif energy > 60:
        t = (energy - 60) / 40
        r = int(50 + (1 - t) * 200)
        g = int(180 + t * 75)
        b = int(80 + t * 70)
    elif energy > 30:
        t = (energy - 30) / 30
        r = int(230 - t * 30)
        g = int(180 * t)
        b = 50
    else:
        t = energy / 30
        r = int(100 + t * 130)
        g = int(30 * t)
        b = int(30 * t)
    return f"rgb({r},{g},{b})"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/state")
def api_state():
    return jsonify(build_response())


@app.route("/api/action", methods=["POST"])
def api_action():
    data = request.json or {}
    action = data.get("action", "tick")
    params = data.get("params", {})

    intensity = params.get("intensity", 50) / 50.0
    entropy_val = params.get("entropy", 30) / 100.0
    cohesion = params.get("cohesion", 60) / 100.0
    decay = params.get("decay", 20) / 100.0

    if action == "tick":
        for n in field._nodes:
            if n._alive:
                n._fx += random.gauss(0, entropy_val * 2)
                n._fy += random.gauss(0, entropy_val * 2)
        result = field.tick(iterations=int(2 * intensity), entropy=entropy_val)

        gather_training_sample()

        if len(training_data) >= 10 and field._epoch % 5 == 0:
            recent = training_data[-20:]
            processor.train_batch(recent, epochs=2, lr=0.05)

    elif action == "pulse":
        for n in field._nodes:
            if not n._alive:
                continue
            dx = n._x - 600
            dy = n._y - 400
            dist = math.sqrt(dx * dx + dy * dy) + 0.1
            force = intensity * 500 / dist
            n._fx += force * dx / dist
            n._fy += force * dy / dist
            n.feed(5 * intensity)
        field.tick(iterations=3, entropy=entropy_val)

    elif action == "scatter":
        for n in field._nodes:
            if n._alive:
                n._fx += random.gauss(0, 50 * intensity)
                n._fy += random.gauss(0, 50 * intensity)
                n._energy -= 5
        field.tick(iterations=5, entropy=entropy_val)

    elif action == "collapse":
        for n in field._nodes:
            if not n._alive:
                continue
            dx = 600 - n._x
            dy = 400 - n._y
            n._fx += dx * cohesion * 0.1
            n._fy += dy * cohesion * 0.1
            n.feed(3)
        field.tick(iterations=5, entropy=entropy_val)

    elif action == "evolve":

        def fitness(genes):
            score = 0
            for i, g in enumerate(genes):
                score += math.sin(g * math.pi) * (i + 1)
            alive = [n for n in field._nodes if n._alive]
            if alive:
                avg_e = sum(n._energy for n in alive) / len(alive)
                score += avg_e / 50.0
            return score

        pool.evaluate(fitness)
        pool.evolve(mutation_rate=entropy_val)
        best_vals, best_score = pool.get_best()
        if best_vals:
            alive = [n for n in field._nodes if n._alive]
            for i, n in enumerate(alive[: len(best_vals)]):
                n._fx += best_vals[i % len(best_vals)] * intensity * 10
                n.feed(2)
        field.tick(iterations=3, entropy=entropy_val)

    elif action == "analyze":
        output = processor.forward([entropy_val, cohesion, intensity, decay])
        for i, n in enumerate(field._nodes):
            if n._alive:
                idx = i % len(output)
                n._fx += (output[idx] - 0.5) * 40
                n.feed(output[idx] * 5)
        field.tick(iterations=2, entropy=entropy_val)

    elif action == "spawn":
        x = params.get("x", random.uniform(100, 1100))
        y = params.get("y", random.uniform(100, 700))
        n = field.spawn(tag=f"s_{random.randint(1000, 9999)}", generation=0)
        n._x = x
        n._y = y
        n._energy = 80.0
        if len(field._nodes) > 1:
            others = [o for o in field._nodes if o is not n and o._alive]
            if others:
                nearest = min(others, key=lambda o: (o._x - x) ** 2 + (o._y - y) ** 2)
                field.connect(n, nearest, k=0.005, rest=120)

    elif action == "reset":
        field._nodes.clear()
        field._epoch = 0
        field._births = 0
        field._deaths = 0
        field._graveyard.clear()
        training_data.clear()
        node_map.clear()
        new_collection = generate_collection(40)
        for i, item in enumerate(new_collection):
            n = field.spawn(tag=item["label"])
            n._x = 600 + item["v"][0] * 2
            n._y = 400 + item["v"][1] * 2
            node_map[i] = n
        for i, item in enumerate(new_collection):
            for target in item["edges"]:
                if target in node_map:
                    try:
                        field.connect(node_map[i], node_map[target], k=0.005, rest=120)
                    except:
                        pass

    elif action == "feed_all":
        for n in field._nodes:
            if n._alive:
                n.feed(20)

    return jsonify(build_response())


if __name__ == "__main__":
    app.run(debug=True, port=5000)

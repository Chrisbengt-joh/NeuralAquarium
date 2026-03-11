import math
import random
import time


class NodeEntity:
    def __init__(self, x, y, m=1.0):
        self._x = x
        self._y = y
        self._m = m
        self._vx = 0.0
        self._vy = 0.0
        self._fx = 0.0
        self._fy = 0.0
        self._links = []
        self._pinned = False
        self._tag = None
        self._energy = 100.0
        self._age = 0
        self._alive = True
        self._generation = 0
        self._birth_time = time.time()
        self._consume_rate = random.uniform(0.2, 0.8)
        self._emit_trail = []

    def bind(self, other, k=0.01, rest=100.0):
        self._links.append((other, k, rest))
        other._links.append((self, k, rest))

    def unbind_all(self):
        for other, _, _ in self._links:
            other._links = [(o, k, r) for o, k, r in other._links if o is not self]
        self._links.clear()

    def apply_repulsion(self, other, c=5000.0):
        if not self._alive or not other._alive:
            return
        dx = self._x - other._x
        dy = self._y - other._y
        dist = math.sqrt(dx * dx + dy * dy) + 0.01
        f = c * self._m * other._m / (dist * dist)
        self._fx += f * dx / dist
        self._fy += f * dy / dist
        other._fx -= f * dx / dist
        other._fy -= f * dy / dist

    def apply_spring(self):
        if not self._alive:
            return
        for other, k, rest in self._links:
            if not other._alive:
                continue
            dx = other._x - self._x
            dy = other._y - self._y
            dist = math.sqrt(dx * dx + dy * dy) + 0.01
            displacement = dist - rest
            fx = k * displacement * dx / dist
            fy = k * displacement * dy / dist
            self._fx += fx
            self._fy += fy

    def metabolize(self, base_cost=0.15, entropy=0.3):
        if not self._alive:
            return
        speed = math.sqrt(self._vx**2 + self._vy**2)
        cost = base_cost * self._consume_rate + speed * 0.01 + entropy * 0.1
        self._energy -= cost
        self._age += 1

        self._emit_trail.append((self._x, self._y, self._energy / 100.0))
        if len(self._emit_trail) > 12:
            self._emit_trail.pop(0)

        if self._energy <= 0:
            self._alive = False
            self._energy = 0

    def feed(self, amount):
        if self._alive:
            self._energy = min(150.0, self._energy + amount)

    def can_reproduce(self):
        return self._alive and self._energy > 90 and self._age > 40

    def step(self, dt=0.4, damping=0.85):
        if self._pinned or not self._alive:
            return
        self._vx = (self._vx + self._fx * dt) * damping
        self._vy = (self._vy + self._fy * dt) * damping
        self._x += self._vx * dt
        self._y += self._vy * dt
        self._fx = 0.0
        self._fy = 0.0

    def serialize(self):
        return {
            "x": round(self._x, 2),
            "y": round(self._y, 2),
            "t": self._tag,
            "p": self._pinned,
            "c": [id(o) for o, _, _ in self._links],
            "energy": round(self._energy, 2),
            "age": self._age,
            "alive": self._alive,
            "gen": self._generation,
            "trail": self._emit_trail[-6:],
        }


class Field:
    def __init__(self, w=800, h=600):
        self._nodes = []
        self._w = w
        self._h = h
        self._epoch = 0
        self._stable = False
        self._births = 0
        self._deaths = 0
        self._graveyard = []

    def spawn(self, tag=None, pinned=False, generation=0):
        x = random.uniform(50, self._w - 50)
        y = random.uniform(50, self._h - 50)
        n = NodeEntity(x, y)
        n._tag = tag
        n._pinned = pinned
        n._generation = generation
        self._nodes.append(n)
        return n

    def connect(self, a, b, k=0.01, rest=100.0):
        a.bind(b, k, rest)

    def reap(self):
        dead = [n for n in self._nodes if not n._alive]
        for d in dead:
            d.unbind_all()
            self._graveyard.append(
                {
                    "tag": d._tag,
                    "age": d._age,
                    "gen": d._generation,
                    "x": d._x,
                    "y": d._y,
                }
            )
        self._deaths += len(dead)
        self._nodes = [n for n in self._nodes if n._alive]
        return len(dead)

    def reproduce(self, max_pop=80):
        if len(self._nodes) >= max_pop:
            return 0
        parents = [n for n in self._nodes if n.can_reproduce()]
        born = 0
        random.shuffle(parents)
        for parent in parents[:3]:
            if len(self._nodes) >= max_pop:
                break
            child = self.spawn(
                tag=f"c_{random.randint(1000, 9999)}", generation=parent._generation + 1
            )
            child._x = parent._x + random.gauss(0, 30)
            child._y = parent._y + random.gauss(0, 30)
            child._consume_rate = parent._consume_rate + random.gauss(0, 0.05)
            child._consume_rate = max(0.05, min(1.5, child._consume_rate))
            child._energy = 60.0
            parent._energy -= 35.0
            self.connect(parent, child, k=0.008, rest=80)
            nearby = sorted(
                self._nodes,
                key=lambda n: (n._x - child._x) ** 2 + (n._y - child._y) ** 2,
            )
            for neighbor in nearby[1:3]:
                if neighbor is not parent and neighbor._alive:
                    self.connect(child, neighbor, k=0.003, rest=150)
            self._births += 1
            born += 1
        return born

    def distribute_energy(self, total=15.0):
        alive = [n for n in self._nodes if n._alive]
        if not alive:
            return
        cx, cy = self._w / 2, self._h / 2
        for n in alive:
            dist = math.sqrt((n._x - cx) ** 2 + (n._y - cy) ** 2)
            proximity = max(0, 1.0 - dist / (self._w * 0.6))
            n.feed(total * proximity / len(alive) * 3)

    def tick(self, iterations=1, entropy=0.3):
        for _ in range(iterations):
            for i in range(len(self._nodes)):
                for j in range(i + 1, len(self._nodes)):
                    self._nodes[i].apply_repulsion(self._nodes[j])
            for n in self._nodes:
                n.apply_spring()
            cx = self._w / 2
            cy = self._h / 2
            for n in self._nodes:
                if n._alive:
                    n._fx += (cx - n._x) * 0.001
                    n._fy += (cy - n._y) * 0.001
                    n.metabolize(entropy=entropy)
            for n in self._nodes:
                n.step()
            self._epoch += 1
        self.distribute_energy()
        dead_count = self.reap()
        born_count = self.reproduce()
        return {"died": dead_count, "born": born_count}

    def snapshot(self):
        id_map = {id(n): i for i, n in enumerate(self._nodes)}
        result = []
        for n in self._nodes:
            d = n.serialize()
            d["id"] = id_map[id(n)]
            d["c"] = [id_map.get(c, -1) for c in d["c"]]
            result.append(d)
        return {
            "epoch": self._epoch,
            "nodes": result,
            "w": self._w,
            "h": self._h,
            "births": self._births,
            "deaths": self._deaths,
            "graveyard_size": len(self._graveyard),
        }

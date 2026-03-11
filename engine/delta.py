import copy
import math
import random


class Strand:
    def __init__(self, length, bounds=None):
        self._genes = []
        self._bounds = bounds or [(-1, 1)] * length
        self._score = None
        for lo, hi in self._bounds:
            self._genes.append(random.uniform(lo, hi))

    def crossover(self, other):
        child = Strand.__new__(Strand)
        child._bounds = self._bounds[:]
        child._score = None
        point = random.randint(1, len(self._genes) - 1)
        child._genes = self._genes[:point] + other._genes[point:]
        return child

    def mutate(self, rate=0.1, strength=0.3):
        for i in range(len(self._genes)):
            if random.random() < rate:
                lo, hi = self._bounds[i]
                self._genes[i] += random.gauss(0, strength)
                self._genes[i] = max(lo, min(hi, self._genes[i]))

    def get_values(self):
        return self._genes[:]

    def set_score(self, s):
        self._score = s

    def get_score(self):
        return self._score


class Pool:
    def __init__(self, size, strand_length, bounds=None):
        self._pop = [Strand(strand_length, bounds) for _ in range(size)]
        self._gen = 0
        self._best = None
        self._history = []

    def evaluate(self, fitness_fn):
        for s in self._pop:
            score = fitness_fn(s.get_values())
            s.set_score(score)
        self._pop.sort(key=lambda s: s.get_score(), reverse=True)
        self._best = self._pop[0]
        self._history.append(
            {
                "gen": self._gen,
                "best": self._best.get_score(),
                "avg": sum(s.get_score() for s in self._pop) / len(self._pop),
            }
        )

    def evolve(self, elite_ratio=0.2, mutation_rate=0.1):
        n = len(self._pop)
        elite_count = max(2, int(n * elite_ratio))
        new_pop = [copy.deepcopy(s) for s in self._pop[:elite_count]]

        while len(new_pop) < n:
            p1 = self._tournament_select()
            p2 = self._tournament_select()
            child = p1.crossover(p2)
            child.mutate(mutation_rate)
            new_pop.append(child)

        self._pop = new_pop
        self._gen += 1

    def _tournament_select(self, k=3):
        candidates = random.sample(self._pop, min(k, len(self._pop)))
        return max(candidates, key=lambda s: s.get_score() or float("-inf"))

    def get_best(self):
        if self._best:
            return self._best.get_values(), self._best.get_score()
        return None, None

    def get_stats(self):
        return {
            "generation": self._gen,
            "population": len(self._pop),
            "history": self._history[-20:],
            "best_score": self._best.get_score() if self._best else None,
        }

namespace MPHRegister.Services.Imports.Bills;

/// <summary>Minimum-cost maximum flow (successive shortest paths) on a small graph: bill lines → inward entries.</summary>
internal sealed class MinCostFlow
{
    private readonly List<Arc>[] arcs;

    public MinCostFlow(int nodes)
    {
        arcs = new List<Arc>[nodes];
        for (var i = 0; i < nodes; i++) arcs[i] = [];
    }

    /// <summary>Adds an arc and returns a handle to read its flow after <see cref="Run"/>.</summary>
    public (int Node, int Index) Add(int from, int to, int capacity, long cost)
    {
        arcs[from].Add(new Arc(to, capacity, cost, arcs[to].Count));
        arcs[to].Add(new Arc(from, 0, -cost, arcs[from].Count - 1));
        return (from, arcs[from].Count - 1);
    }

    public int FlowOn((int Node, int Index) handle)
    {
        var arc = arcs[handle.Node][handle.Index];
        return arcs[arc.To][arc.Reverse].Capacity;
    }

    public void Run(int source, int sink)
    {
        var distance = new long[arcs.Length];
        var previous = new (int Node, int Index)[arcs.Length];
        while (ShortestPath(source, sink, distance, previous))
        {
            var push = int.MaxValue;
            for (var v = sink; v != source; v = previous[v].Node) push = Math.Min(push, arcs[previous[v].Node][previous[v].Index].Capacity);
            for (var v = sink; v != source; v = previous[v].Node)
            {
                var (u, i) = previous[v];
                var arc = arcs[u][i];
                arcs[u][i] = arc with { Capacity = arc.Capacity - push };
                var back = arcs[v][arc.Reverse];
                arcs[v][arc.Reverse] = back with { Capacity = back.Capacity + push };
            }
        }
    }

    /// <summary>Bellman-Ford with a queue (SPFA); costs may be negative on reverse arcs.</summary>
    private bool ShortestPath(int source, int sink, long[] distance, (int Node, int Index)[] previous)
    {
        Array.Fill(distance, long.MaxValue);
        var queued = new bool[arcs.Length];
        var queue = new Queue<int>();
        distance[source] = 0;
        queue.Enqueue(source);
        queued[source] = true;
        while (queue.Count > 0)
        {
            var u = queue.Dequeue();
            queued[u] = false;
            for (var i = 0; i < arcs[u].Count; i++)
            {
                var arc = arcs[u][i];
                if (arc.Capacity <= 0 || distance[u] + arc.Cost >= distance[arc.To]) continue;
                distance[arc.To] = distance[u] + arc.Cost;
                previous[arc.To] = (u, i);
                if (queued[arc.To]) continue;
                queued[arc.To] = true;
                queue.Enqueue(arc.To);
            }
        }
        return distance[sink] != long.MaxValue;
    }

    private readonly record struct Arc(int To, int Capacity, long Cost, int Reverse);
}

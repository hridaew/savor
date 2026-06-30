import { useCallback, useEffect, useRef, useState } from 'react';
import type { Capture, ServerMessage } from './types';
import { listCaptures, deleteCapture } from './api';

function sorted(map: Map<string, Capture>): Capture[] {
  return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function useStore() {
  const mapRef = useRef<Map<string, Capture>>(new Map());
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [connected, setConnected] = useState(false);

  const flush = useCallback(() => setCaptures(sorted(mapRef.current)), []);

  const upsert = useCallback(
    (cap: Capture) => {
      mapRef.current.set(cap.id, cap);
      flush();
    },
    [flush],
  );

  const remove = useCallback(
    async (id: string) => {
      mapRef.current.delete(id);
      flush();
      try {
        await deleteCapture(id);
      } catch {
        /* ignore */
      }
    },
    [flush],
  );

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let alive = true;

    // initial fetch as a fallback before/independent of the socket
    listCaptures()
      .then((list) => {
        if (!alive) return;
        for (const c of list) mapRef.current.set(c.id, c);
        flush();
      })
      .catch(() => {});

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (alive) retry = setTimeout(connect, 1200);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === 'snapshot') {
          for (const c of msg.captures) mapRef.current.set(c.id, c);
        } else if (msg.type === 'update') {
          mapRef.current.set(msg.capture.id, msg.capture);
        } else if (msg.type === 'removed') {
          mapRef.current.delete(msg.id);
        } else {
          return;
        }
        flush();
      };
    };
    connect();

    return () => {
      alive = false;
      clearTimeout(retry);
      ws?.close();
    };
  }, [flush]);

  return { captures, connected, upsert, remove };
}

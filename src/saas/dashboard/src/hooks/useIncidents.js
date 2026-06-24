import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export function useIncidents(filters = {}) {
  const [incidents, setIncidents] = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.status)   params.set('status', filters.status);
      if (filters.severity) params.set('severity', filters.severity);
      if (filters.service)  params.set('service', filters.service);
      params.set('limit',  String(filters.limit  || 25));
      params.set('offset', String(filters.offset || 0));

      const data = await api.get(`/incidents?${params}`);
      setIncidents(data.incidents || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.severity, filters.service, filters.limit, filters.offset]);

  useEffect(() => { load(); }, [load]);

  // Poll every 30 seconds for live updates
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  return { incidents, total, loading, error, reload: load };
}

export function useIncident(id) {
  const [incident, setIncident] = useState(null);
  const [events, setEvents]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [inc, evts] = await Promise.all([
        api.get(`/incidents/${id}`),
        api.get(`/incidents/${id}/events`),
      ]);
      setIncident(inc);
      setEvents(evts.events || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const addComment = async (message) => {
    await api.post(`/incidents/${id}/events`, { message });
    await load();
  };

  const resolve = async () => {
    await api.post(`/incidents/${id}/resolve`, {});
    await load();
  };

  const update = async (fields) => {
    await api.patch(`/incidents/${id}`, fields);
    await load();
  };

  return { incident, events, loading, error, addComment, resolve, update, reload: load };
}

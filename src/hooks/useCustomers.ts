import { useCallback, useEffect, useState } from 'react';
import { authHeader } from '../lib/auth';
import type { CustomerProfile, TimelineEvent } from '../types/customer';

function cloneCustomer(customer: CustomerProfile): CustomerProfile {
  return {
    ...customer,
    intentSignals: [...customer.intentSignals],
    orders: customer.orders.map(order => ({
      ...order,
      items: order.items ? order.items.map(item => ({ ...item })) : undefined,
    })),
    tags: [...customer.tags],
    timeline: customer.timeline.map(event => ({ ...event })),
  };
}

export function useCustomers(refreshKey = 0): {
  customers: CustomerProfile[];
  updateCustomer: (id: string, patch: Partial<CustomerProfile>) => void;
  appendTimelineEvent: (id: string, event: TimelineEvent) => void;
  updateTimelineEvent: (customerId: string, eventId: string, patch: Partial<TimelineEvent>) => void;
  removeTimelineEvent: (customerId: string, eventId: string) => void;
  loading: boolean;
} {
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const loadLiveCustomers = async () => {
      const data = await fetch('/api/overseas/customers', { headers: authHeader() }).then(resp => resp.ok ? resp.json() : null);
      const items = Array.isArray(data?.items) ? data.items : [];
      if (alive) setCustomers(items.map((item: CustomerProfile) => cloneCustomer({ ...item, isReal: true })));
    };
    const load = async () => {
      setLoading(true);
      try {
        await loadLiveCustomers();
        timer = window.setInterval(() => {
          void loadLiveCustomers().catch(() => {});
        }, 30_000);
      } catch {
        if (alive) setCustomers([]);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [refreshKey]);

  const updateCustomer = useCallback((id: string, patch: Partial<CustomerProfile>) => {
    setCustomers(list => list.map(customer => (
      customer.id === id ? { ...customer, ...patch } : customer
    )));
  }, []);

  const appendTimelineEvent = useCallback((id: string, event: TimelineEvent) => {
    setCustomers(list => list.map(customer => (
      customer.id === id
        ? { ...customer, timeline: [...customer.timeline, event], todoCompletedAt: event.actor === 'buyer' ? undefined : customer.todoCompletedAt }
        : customer
    )));
  }, []);

  const updateTimelineEvent = useCallback((customerId: string, eventId: string, patch: Partial<TimelineEvent>) => {
    setCustomers(list => list.map(customer => (
      customer.id === customerId
        ? { ...customer, timeline: customer.timeline.map(event => event.id === eventId ? { ...event, ...patch } : event) }
        : customer
    )));
  }, []);

  const removeTimelineEvent = useCallback((customerId: string, eventId: string) => {
    setCustomers(list => list.map(customer => (
      customer.id === customerId
        ? { ...customer, timeline: customer.timeline.filter(event => event.id !== eventId) }
        : customer
    )));
  }, []);

  return {
    customers,
    updateCustomer,
    appendTimelineEvent,
    updateTimelineEvent,
    removeTimelineEvent,
    loading,
  };
}

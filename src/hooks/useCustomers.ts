import { useCallback, useEffect, useState } from 'react';
import { authHeader } from '../lib/auth';
import { createMockCustomers } from '../mocks/customerProfiles';
import type { CustomerProfile, TimelineEvent } from '../types/customer';

const MOCK_STORAGE_KEY = 'lingshu:mock-customer-conversations:v2';

function storedMockCustomers(): CustomerProfile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed) || !parsed.length) return createMockCustomers();
    const stored = parsed.map(cloneCustomer);
    if (stored.some(customer => /LED pendant lights|吊灯/i.test(`${customer.product} ${customer.outboundProduct} ${customer.timeline.map(item => item.body).join(' ')}`))) {
      localStorage.removeItem(MOCK_STORAGE_KEY);
      return createMockCustomers();
    }
    return stored;
  } catch {
    return createMockCustomers();
  }
}

function persistMockCustomers(customers: CustomerProfile[]) {
  try { localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(customers.filter(customer => customer.isMock))); } catch { /* ignore storage quota */ }
}

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

export function useCustomers(refreshKey = 0, includeMockCustomers = false): {
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
      if (!alive) return;
      const liveCustomers = items.map((item: CustomerProfile) => cloneCustomer({ ...item, isReal: true, isMock: false }));
      setCustomers(current => {
        if (!includeMockCustomers) return liveCustomers;
        const existingMocks = current.filter(customer => customer.isMock).map(cloneCustomer);
        return [...liveCustomers, ...(existingMocks.length ? existingMocks : storedMockCustomers())];
      });
    };
    const load = async () => {
      setLoading(true);
      try {
        await loadLiveCustomers();
        timer = window.setInterval(() => {
          void loadLiveCustomers().catch(() => {});
        }, 30_000);
      } catch {
        if (alive) setCustomers(current => {
          if (!includeMockCustomers) return [];
          const existingMocks = current.filter(customer => customer.isMock).map(cloneCustomer);
          return existingMocks.length ? existingMocks : storedMockCustomers();
        });
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [refreshKey, includeMockCustomers]);

  const updateCustomer = useCallback((id: string, patch: Partial<CustomerProfile>) => {
    setCustomers(list => {
      const next = list.map(customer => customer.id === id ? { ...customer, ...patch } : customer);
      persistMockCustomers(next);
      return next;
    });
  }, []);

  const appendTimelineEvent = useCallback((id: string, event: TimelineEvent) => {
    setCustomers(list => {
      const next = list.map(customer => customer.id === id
        ? { ...customer, timeline: [...customer.timeline, event], todoCompletedAt: event.actor === 'buyer' ? undefined : customer.todoCompletedAt }
        : customer
      );
      persistMockCustomers(next);
      return next;
    });
  }, []);

  const updateTimelineEvent = useCallback((customerId: string, eventId: string, patch: Partial<TimelineEvent>) => {
    setCustomers(list => {
      const next = list.map(customer => customer.id === customerId
        ? { ...customer, timeline: customer.timeline.map(event => event.id === eventId ? { ...event, ...patch } : event) }
        : customer
      );
      persistMockCustomers(next);
      return next;
    });
  }, []);

  const removeTimelineEvent = useCallback((customerId: string, eventId: string) => {
    setCustomers(list => {
      const next = list.map(customer => customer.id === customerId
        ? { ...customer, timeline: customer.timeline.filter(event => event.id !== eventId) }
        : customer
      );
      persistMockCustomers(next);
      return next;
    });
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

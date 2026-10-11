import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { inboxApi } from '../../api/ops';
import { useActiveStore } from '../../hooks/useStore';
import { NoStore, PageHeader } from '../../components/common/ui';
import './Tools.css';

/** Every tool beyond the daily tabs, grouped by what the shopkeeper is doing. */
const GROUPS: { title: string; links: { to: string; label: string; hint: string }[] }[] = [
  {
    title: 'Today',
    links: [
      { to: '/inbox', label: 'Inbox', hint: 'Alerts, refunds, messages' },
      { to: '/messages', label: 'Customer messages', hint: 'Questions, requests, support' },
      { to: '/refunds', label: 'Refunds', hint: 'Money owed back on cancelled orders' },
    ],
  },
  {
    title: 'Stock and buying',
    links: [
      { to: '/purchases', label: 'Purchases', hint: 'Suppliers, invoices, receiving stock' },
      { to: '/batches', label: 'Batches & expiry', hint: 'What is expiring, write-offs' },
      { to: '/suggestions', label: 'What to reorder', hint: 'Suggested purchase list' },
      { to: '/catalogue-tools', label: 'Catalogue tools', hint: 'Templates, import/export, bulk changes' },
    ],
  },
  {
    title: 'Customers',
    links: [
      { to: '/customers', label: 'Customers', hint: 'Who buys, how often, notes' },
      { to: '/khata', label: 'Khata', hint: 'Credit, payments, reminders' },
      { to: '/promotions', label: 'Loyalty, coupons & offers', hint: 'Points, discount codes, expiry offers' },
      { to: '/announcements', label: 'Announcements', hint: 'Tell your followers' },
    ],
  },
  {
    title: 'Running the shop',
    links: [
      { to: '/analytics', label: 'Reports', hint: 'Sales, orders, best and slow sellers' },
      { to: '/automation', label: 'Automation', hint: 'Recurring tasks, alerts' },
      { to: '/share', label: 'Share your shop', hint: 'Link, QR code, WhatsApp' },
      { to: '/verification', label: 'Verification', hint: 'Business details and documents' },
    ],
  },
];

export default function MorePage() {
  const { activeStoreId } = useActiveStore();
  const { data } = useQuery({
    queryKey: ['inbox-count', activeStoreId],
    queryFn: () => inboxApi.list(activeStoreId!, { unreadOnly: 'true', limit: 1 }),
    enabled: !!activeStoreId,
  });
  if (!activeStoreId) return <NoStore title="More" />;
  const unread = data?.data.unreadCount ?? 0;

  return (
    <div>
      <PageHeader title="More" subtitle="Everything else for running your shop." />
      {GROUPS.map((group) => (
        <section key={group.title} className="tools-group">
          <h2 className="tools-group__title">{group.title}</h2>
          <div className="tools-grid">
            {group.links.map((link) => (
              <Link key={link.to} to={link.to} className="tools-card">
                <span className="tools-card__label">
                  {link.label}
                  {link.to === '/inbox' && unread > 0 && <span className="badge badge-warning" style={{ marginLeft: 8 }}>{unread} new</span>}
                </span>
                <span className="tools-card__hint">{link.hint}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

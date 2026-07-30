import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export default async () => {
  render(<ProfileBlock />, document.body);
};

function ProfileBlock() {
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    async function verify() {
      try {
        const token = await shopify.sessionToken.get();
        const res = await fetch(
          'https://naia-stylist-staging.vercel.app/api/customer-account-identity',
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) { setStatus('error'); return; }
        const json = await res.json();
        setStatus(json.customerIdentityAvailable ? 'connected' : 'unavailable');
      } catch {
        setStatus('error');
      }
    }
    verify();
  }, []);

  if (status === 'loading') {
    return (
      <s-banner>
        <s-text>{shopify.i18n.translate('loading')}</s-text>
      </s-banner>
    );
  }
  if (status === 'connected') {
    return (
      <s-banner>
        <s-text>{shopify.i18n.translate('connected')}</s-text>
      </s-banner>
    );
  }
  if (status === 'unavailable') {
    return (
      <s-banner>
        <s-text>{shopify.i18n.translate('unavailable')}</s-text>
      </s-banner>
    );
  }
  return (
    <s-banner>
      <s-text>{shopify.i18n.translate('error')}</s-text>
    </s-banner>
  );
}

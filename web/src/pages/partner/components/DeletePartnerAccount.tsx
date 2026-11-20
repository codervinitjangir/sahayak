import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { ApiError } from '../../../services/api';
import { partnerService } from '../../../services/partner.service';
import { useAuth } from '../../../app/AuthProvider';

/** What deleting a partner account does (ADR-045). Same words as the mobile app. */
export const PARTNER_DELETE_COPY =
  'Your name, phone, services, documents and job alerts are erased and you are signed out. Past jobs stay on record without your details. If this number also has an owner profile, that profile stays. This cannot be undone.';

/** Download everything Sahayak stores about the partner, as JSON (DPDP right of access). */
export const PartnerDataExport: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setError(null);
    try {
      const data = await partnerService.exportMe();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sahayak-partner-data.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Released later: revoking straight after click() can cancel the download.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setError('Could not prepare your data. Try again.');
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => void download()}>
        <Download className="h-4 w-4" aria-hidden="true" /> Download my data
      </Button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </>
  );
};

/** Partner self-service account deletion on web (ADR-045, Google Play account-deletion rule). */
export const DeletePartnerAccount: React.FC = () => {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () => partnerService.deleteMe(),
    onSuccess: () => logout(),
  });
  const error = remove.error instanceof ApiError && remove.error.code === 'ACCOUNT_HAS_ACTIVE_JOB'
    ? 'Finish your active job and answer any open offer first.'
    : remove.isError ? 'Could not delete your account. Try again.' : null;

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => { remove.reset(); setOpen(true); }}>
        <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete partner account
      </Button>
      {open && (
        <Modal isOpen onClose={() => setOpen(false)} title="Delete your partner account?" maxWidth="sm"
          description={PARTNER_DELETE_COPY}>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Keep my account</Button>
            <Button size="sm" variant="danger" onClick={() => remove.mutate()} isLoading={remove.isPending}>
              Delete account
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
};

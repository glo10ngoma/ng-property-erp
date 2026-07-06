import { Modal } from './Modal';

export function ConfirmDialog({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="actions">
        <button className="secondary" onClick={onCancel}>Annuler</button>
        <button className="danger" onClick={onConfirm}>Confirmer</button>
      </div>
    </Modal>
  );
}

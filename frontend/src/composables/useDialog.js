let confirmModalRef = null
let messageModalRef = null

export function registerConfirmModal(ref) {
  confirmModalRef = ref
}

export function registerMessageModal(ref) {
  messageModalRef = ref
}

export function confirm(opts) {
  if (!confirmModalRef) return Promise.resolve(false)
  return confirmModalRef.open(opts)
}

export function message(opts) {
  if (!messageModalRef) return Promise.resolve()
  return messageModalRef.open(opts)
}

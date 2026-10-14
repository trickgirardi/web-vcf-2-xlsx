import { handleRequest } from './handler';
import type { WorkerRequest, WorkerResponse } from './protocol';

// Mensagens são tratadas em série: o cliente só envia o próximo job depois do
// anterior terminar (ou termina o worker, no cancelamento).
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
	void handleRequest(event.data, (response: WorkerResponse) => self.postMessage(response));
});

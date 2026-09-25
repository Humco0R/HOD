import type {
  AiDetectionInput,
  AiDetectionPort,
  DetectionCandidate,
} from '../../modules/detections';

export class FakeAiDetectionAdapter implements AiDetectionPort {
  detect(input: AiDetectionInput): Promise<DetectionCandidate> {
    const text = input.job.text?.trim() ?? '';
    const actionable = /(проверь|проверить|сделай|заедь|отправь|пришли)/iu.test(text);
    if (!actionable) return Promise.resolve(notActionable());

    const assigneeReference = /^\s*([\p{L}-]+)\s*,/u.exec(text)?.[1] ?? null;
    const checkedObject = /проверь\s+([^,.]+?)(?:\s+и\s+|[,.]|$)/iu.exec(text)?.[1]?.trim();
    const title = checkedObject
      ? `Проверить ${checkedObject.toLocaleLowerCase('ru-RU')}`
      : 'Выполнить поручение';
    const dependency = /(после\s+[\p{L}-]+)/iu.exec(text)?.[1] ?? null;
    const location = /(?:на|по)\s+([\p{L}-]+)(?:\s*,|\s+проверь|$)/iu.exec(text)?.[1] ?? null;
    const expectedResultType = /фото/iu.test(text) ? ('PHOTO' as const) : ('UNKNOWN' as const);

    return Promise.resolve({
      classification: 'ACTIONABLE',
      title,
      assigneeReference,
      deadlineKind: dependency ? 'DEPENDENCY' : 'UNKNOWN',
      deadlineAt: null,
      deadlineDate: null,
      deadlineDependency: dependency,
      deadlineRaw: /завтра/iu.test(text)
        ? dependency
          ? `завтра, ${dependency}`
          : 'завтра'
        : dependency,
      expectedResultType,
      expectedResultText: expectedResultType === 'PHOTO' ? 'Фото результата' : null,
      location,
      confidence: 0.99,
      raw: { adapter: 'fake', version: 1 },
    });
  }
}

function notActionable(): DetectionCandidate {
  return {
    classification: 'NOT_ACTIONABLE',
    title: null,
    assigneeReference: null,
    deadlineKind: 'UNKNOWN',
    deadlineAt: null,
    deadlineDate: null,
    deadlineDependency: null,
    deadlineRaw: null,
    expectedResultType: 'UNKNOWN',
    expectedResultText: null,
    location: null,
    confidence: 0.99,
    raw: { adapter: 'fake', version: 1 },
  };
}

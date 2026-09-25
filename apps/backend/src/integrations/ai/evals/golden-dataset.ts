import type { Actionability, DeadlineKind, ExpectedResultType } from '../../../modules/detections';

export interface GoldenDetectionCase {
  id: string;
  category: 'DIRECT' | 'DISCUSSION' | 'UNCERTAIN' | 'AMBIGUOUS';
  text: string;
  expected: {
    classification: Actionability;
    deadlineKind: DeadlineKind;
    expectedResultType: ExpectedResultType;
    assigneeReferenceOneOf: string[];
  };
}

const directScenarios = [
  ['после Кирова заедь на Пушкина, проверь кондиционер и пришли фото', 'DEPENDENCY', 'PHOTO'],
  ['завтра до 15:00 отправь заказчику акт в PDF', 'EXACT_DATETIME', 'FILE'],
  ['21 сентября проверь остатки на складе', 'DATE_ONLY', 'UNKNOWN'],
  ['когда освободишься, позвони поставщику и напиши итог', 'RELATIVE', 'TEXT'],
  ['замени фильтр в офисе и приложи фото', 'UNKNOWN', 'PHOTO'],
  ['до пятницы подготовь смету и отправь файл', 'DATE_ONLY', 'FILE'],
  ['после поставки установи насос на объекте Северный', 'DEPENDENCY', 'UNKNOWN'],
  ['сегодня в 18:30 забери документы у клиента', 'EXACT_DATETIME', 'NONE'],
  ['проверь жалобу клиента и сообщи, что выяснил', 'UNKNOWN', 'TEXT'],
  ['на следующей неделе согласуй график выездов', 'RELATIVE', 'UNKNOWN'],
  ['22 сентября сфотографируй показания счётчика', 'DATE_ONLY', 'PHOTO'],
  ['после обеда отвези договор на подпись', 'RELATIVE', 'NONE'],
  ['после согласования закупи расходники', 'DEPENDENCY', 'UNKNOWN'],
  ['завтра в 09:00 открой объект для подрядчика', 'EXACT_DATETIME', 'NONE'],
  ['до 25 сентября подготовь отчёт о выполненных работах', 'DATE_ONLY', 'FILE'],
  ['проверь протечку на Лесной и пришли видеоотчёт', 'UNKNOWN', 'FILE'],
  ['как получишь доступ, обнови прошивку контроллера', 'DEPENDENCY', 'UNKNOWN'],
  ['вечером уточни у клиента время визита', 'RELATIVE', 'TEXT'],
  ['23 сентября забери запчасти со склада', 'DATE_ONLY', 'NONE'],
  ['сегодня до 17:45 пришли подписанный акт', 'EXACT_DATETIME', 'FILE'],
] as const satisfies ReadonlyArray<readonly [string, DeadlineKind, ExpectedResultType]>;

const discussionMessages = [
  'Кто-нибудь знает, почему кондиционер снова шумит?',
  'Кажется, завтра будет дождь.',
  'А если перенести выезд на следующую неделю?',
  'Спасибо, акт уже получил.',
  'Обсуждали вчера поставку насосов и новые цены.',
  'Антон сейчас на объекте?',
  'Мне нравится вариант с новым фильтром.',
  'Фото с прошлой установки выглядит хорошо.',
  'Во сколько обычно открывается склад?',
  'Поставщик сказал, что детали пока нет.',
] as const;

const uncertainMessages = [
  'Можно было бы как-нибудь проверить кондиционер.',
  'Наверное, стоит подумать об отчёте.',
  'Если будет время, неплохо бы созвониться с клиентом.',
  'Возможно, фильтр когда-нибудь придётся заменить.',
  'Есть идея сфотографировать новые стойки.',
] as const;

const ambiguousTasks = [
  'проверь объект на Пушкина',
  'пришли фото нового насоса',
  'завтра забери документы',
  'после поставки установи фильтр',
  'подготовь акт выполненных работ',
] as const;

export function createGoldenDataset(): GoldenDetectionCase[] {
  const direct = directScenarios.flatMap(([task, deadlineKind, expectedResultType], scenario) =>
    [
      `Антон, ${task}.`,
      `@anton, пожалуйста, ${task}.`,
      `Антон — договорились: ${task}.`,
      `Антон, возьми в работу: ${task}.`,
    ].map((text, variant) => ({
      id: `direct-${String(scenario + 1)}-${String(variant + 1)}`,
      category: 'DIRECT' as const,
      text,
      expected: {
        classification: 'ACTIONABLE' as const,
        deadlineKind,
        expectedResultType,
        assigneeReferenceOneOf: ['Антон', '@anton', 'anton'],
      },
    })),
  );
  const discussion = discussionMessages.flatMap((message, scenario) =>
    ['', 'Коллеги, ', 'К слову, ', 'Вопрос: '].map((prefix, variant) => ({
      id: `discussion-${String(scenario + 1)}-${String(variant + 1)}`,
      category: 'DISCUSSION' as const,
      text: `${prefix}${lowerFirst(message)}`,
      expected: {
        classification: 'NOT_ACTIONABLE' as const,
        deadlineKind: 'UNKNOWN' as const,
        expectedResultType: 'UNKNOWN' as const,
        assigneeReferenceOneOf: [],
      },
    })),
  );
  const uncertain = uncertainMessages.flatMap((message, scenario) =>
    ['', 'Мне кажется, ', 'На будущее: ', 'Просто мысль — '].map((prefix, variant) => ({
      id: `uncertain-${String(scenario + 1)}-${String(variant + 1)}`,
      category: 'UNCERTAIN' as const,
      text: `${prefix}${lowerFirst(message)}`,
      expected: {
        classification: 'UNCERTAIN' as const,
        deadlineKind: 'UNKNOWN' as const,
        expectedResultType: 'UNKNOWN' as const,
        assigneeReferenceOneOf: [],
      },
    })),
  );
  const ambiguous = ambiguousTasks.flatMap((task, scenario) =>
    [
      `Антон, ${task}.`,
      `Антон, пожалуйста, ${task}.`,
      `Пусть Антон ${task}.`,
      `Антон — ${task}.`,
    ].map((text, variant) => ({
      id: `ambiguous-${String(scenario + 1)}-${String(variant + 1)}`,
      category: 'AMBIGUOUS' as const,
      text,
      expected: {
        classification: 'ACTIONABLE' as const,
        deadlineKind: inferDeadlineKind(task),
        expectedResultType: task.includes('фото') ? ('PHOTO' as const) : ('UNKNOWN' as const),
        assigneeReferenceOneOf: ['Антон'],
      },
    })),
  );
  return [...direct, ...discussion, ...uncertain, ...ambiguous];
}

function lowerFirst(value: string): string {
  return `${value.slice(0, 1).toLocaleLowerCase('ru-RU')}${value.slice(1)}`;
}

function inferDeadlineKind(value: string): DeadlineKind {
  if (value.includes('завтра')) return 'DATE_ONLY';
  if (value.includes('после поставки')) return 'DEPENDENCY';
  return 'UNKNOWN';
}

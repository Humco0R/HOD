export interface ActionReminderScheduleStore {
  schedule(now: Date, leadMinutes: number): Promise<number>;
}

export class ScheduleActionRemindersUseCase {
  constructor(private readonly store: ActionReminderScheduleStore) {}

  execute(now: Date, leadMinutes: number): Promise<number> {
    return this.store.schedule(now, leadMinutes);
  }
}

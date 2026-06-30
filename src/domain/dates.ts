import { AppError } from "../errors.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateDateRange(startDate: string, endDate: string): void {
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    throw new AppError("VALIDATION_ERROR", "Dates must use YYYY-MM-DD format.");
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError("VALIDATION_ERROR", "The supplied date is invalid.");
  }
  if (start.toISOString().slice(0, 10) !== startDate || end.toISOString().slice(0, 10) !== endDate) {
    throw new AppError("VALIDATION_ERROR", "The supplied date is invalid.");
  }
  if (start > end) throw new AppError("VALIDATION_ERROR", "startDate must not be after endDate.");
}

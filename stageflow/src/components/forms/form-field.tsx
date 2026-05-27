"use client";

import * as React from "react";
import {
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";

import {
  FormField as BaseFormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

type FieldType = "text" | "email" | "password" | "number" | "url" | "textarea" | "select" | "checkbox" | "switch";

interface SelectOption {
  label: string;
  value: string;
}

interface FormFieldProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  form: UseFormReturn<TFieldValues>;
  name: TName;
  label?: string;
  description?: string;
  placeholder?: string;
  type?: FieldType;
  options?: SelectOption[];
  disabled?: boolean;
  className?: string;
}

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  form,
  name,
  label,
  description,
  placeholder,
  type = "text",
  options,
  disabled,
  className,
}: FormFieldProps<TFieldValues, TName>) {
  return (
    <BaseFormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          {label && type !== "checkbox" && type !== "switch" && (
            <FormLabel>{label}</FormLabel>
          )}

          {type === "textarea" ? (
            <FormControl>
              <Textarea
                placeholder={placeholder}
                disabled={disabled}
                {...field}
              />
            </FormControl>
          ) : type === "select" ? (
            <Select
              onValueChange={field.onChange}
              defaultValue={field.value}
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={placeholder} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {options?.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : type === "checkbox" ? (
            <div className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={disabled}
                />
              </FormControl>
              {label && (
                <div className="space-y-1 leading-none">
                  <FormLabel>{label}</FormLabel>
                </div>
              )}
            </div>
          ) : type === "switch" ? (
            <div className="flex flex-row items-center justify-between space-y-0">
              {label && <FormLabel>{label}</FormLabel>}
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={disabled}
                />
              </FormControl>
            </div>
          ) : (
            <FormControl>
              <Input
                type={type}
                placeholder={placeholder}
                disabled={disabled}
                {...field}
              />
            </FormControl>
          )}

          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export { FormField, type FormFieldProps };

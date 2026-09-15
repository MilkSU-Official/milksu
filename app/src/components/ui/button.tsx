import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/30 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        brand: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-border bg-transparent text-foreground hover:bg-accent',
        secondary: 'border border-border bg-transparent text-foreground hover:bg-accent',
        ghost: 'text-foreground hover:bg-accent',
        quiet: 'text-muted-foreground hover:text-foreground',
        link: 'text-muted-foreground underline-offset-4 hover:text-foreground hover:underline',
        'link-static': 'text-muted-foreground underline underline-offset-4',
        'link-draw': 'text-muted-foreground hover:text-foreground',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3',
        lg: 'h-10 rounded-md px-6',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
        text: 'h-auto rounded-sm px-1.5 py-[5px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        data-slot="button"
        data-variant={variant ?? 'default'}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }

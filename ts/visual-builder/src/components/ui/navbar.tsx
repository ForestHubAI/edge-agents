import { Button } from "./button";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { User, LogOut, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "./language-switcher";
import { PlanBadge } from "@/components/billing/PlanBadge";

export const Navbar = () => {
  const { user, signOut } = useAuth();
  const { t } = useTranslation();

  const handleSignOut = async () => {
    await signOut();
    window.location.href = "/auth";
  };

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="mr-4 flex">
          <Link to="/" className="mr-6 flex items-center space-x-2">
            <span className="font-bold">ForestHub</span>
          </Link>
          <nav className="flex gap-6 text-sm">
            <Link to="/dashboard" className="text-muted-foreground hover:text-foreground">
              {t("navbar.dashboard")}
            </Link>
            <Link to="/agents" className="text-muted-foreground hover:text-foreground">
              {t("navbar.agents")}
            </Link>
            <Link to="/registry" className="text-muted-foreground hover:text-foreground">
              {t("navbar.registry")}
            </Link>
            <Link to="/credits" className="text-muted-foreground hover:text-foreground">
              {t("navbar.credits")}
            </Link>
          </nav>
        </div>

        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <div className="flex items-center space-x-2">
            <LanguageSwitcher />
            <PlanBadge />
          </div>
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.profile?.avatarUrl} alt={user.email} />
                    <AvatarFallback>
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuItem className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.profile?.displayName || "User"}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings" className="flex items-center w-full">
                    <span className="flex items-center w-full">
                      <Settings className="mr-2 h-4 w-4" />
                      <span>{t("navbar.settings")}</span>
                    </span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{t("navbar.signOut")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link to="/auth">
              <Button variant="default">{t("navbar.signIn")}</Button>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
};

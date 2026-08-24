#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char buf[8]; int n=fread(buf,1,8,input); buf[n]='\0';
    fclose(input);
    return 0;
}

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char *p=malloc(8); fread(p,1,8,input); free(p); free(p);
    fclose(input);
    return 0;
}

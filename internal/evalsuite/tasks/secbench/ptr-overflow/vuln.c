#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char *p=malloc(8); size_t n=0; fread(&n,sizeof n,1,input); p[n]=1;
    fclose(input);
    return 0;
}

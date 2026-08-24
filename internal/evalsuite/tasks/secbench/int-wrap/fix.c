#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    int n; fread(&n,4,1,input); if(n>0&&n<8){char *p=malloc((size_t)n+1); fread(p,1,(size_t)n,input); free(p);}
    fclose(input);
    return 0;
}
